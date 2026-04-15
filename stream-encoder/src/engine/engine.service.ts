import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn, ChildProcess } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Client } from 'pg';
import { EncoderJobRow, EngineStatus } from './engine.types';

@Injectable()
export class EngineService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EngineService.name);
  private readonly nodeName: string;
  private readonly pollMs: number;
  private readonly ffmpegBin: string;
  private readonly prefetchEnabled: boolean;
  private readonly prefetchLogSkips: boolean;
  private readonly cacheDir: string;
  private pg: Client;

  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private currentProcess: ChildProcess | null = null;
  private currentStatus: EngineStatus = 'idle';
  private currentLivestreamId: string | null = null;
  private currentMediaPath: string | null = null;
  private currentOutputRtmpUrl: string | null = null;
  private currentMediaId: string | null = null;
  private currentTimestampStr = '00:00:00.000';
  private currentTimestampMs = 0;
  private currentFrames = 0;
  private currentBitrate = '0kbits/s';
  private currentSpeed = '0x';
  private currentLockKey: string | null = null;
  private stderrBuffer = '';
  private readonly mediaStorageKeyCache = new Map<string, string>();
  private readonly prefetchTasks = new Map<string, Promise<void>>();

  constructor(private readonly config: ConfigService) {
    this.nodeName = this.config.get<string>('ENGINE_NODE', 'primary');
    this.pollMs = this.config.get<number>('ENGINE_DB_POLL_MS', 2000);
    this.ffmpegBin = this.config.get<string>('ENGINE_FFMPEG_BIN', 'ffmpeg');
    this.prefetchEnabled = this.config.get<string>('ENGINE_PREFETCH_ENABLED', 'true') === 'true';
    this.prefetchLogSkips =
      this.config.get<string>('ENGINE_PREFETCH_LOG_SKIPS', 'false') === 'true';
    this.cacheDir = this.config.get<string>('ENGINE_CACHE_DIR', '/tmp/encoder-cache');

    this.pg = this.createPgClient();
  }

  private createPgClient(): Client {
    return new Client({
      host: this.config.get<string>('POSTGRES_HOST', 'localhost'),
      port: this.config.get<number>('POSTGRES_PORT', 5432),
      user: this.config.get<string>('POSTGRES_USER'),
      password: this.config.get<string>('POSTGRES_PASSWORD'),
      database: this.config.get<string>('POSTGRES_DB'),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.connectWithRetry();
    if (this.prefetchEnabled) {
      await mkdir(this.cacheDir, { recursive: true });
      this.logger.log(`Media prefetch enabled, cacheDir=${this.cacheDir}`);
    }
    this.pollHandle = setInterval(() => void this.safePoll(), this.pollMs);
    this.logger.log(`Engine node=${this.nodeName} polling every ${this.pollMs}ms`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pollHandle) clearInterval(this.pollHandle);
    await this.stopFfmpeg('stopped');
    await this.pg.end().catch(() => undefined);
  }

  getHealth() {
    return {
      node: this.nodeName,
      status: this.currentStatus,
      livestreamId: this.currentLivestreamId,
      timestamp_ms: this.currentTimestampMs,
      timestamp_str: this.currentTimestampStr,
      frames: this.currentFrames,
      bitrate: this.currentBitrate,
      speed: this.currentSpeed,
      pid: this.currentProcess?.pid ?? null,
    };
  }

  async probeMediaPath(mediaPath: string): Promise<{ ok: boolean; error?: string }> {
    if (!mediaPath) return { ok: false, error: 'mediaPath is required' };

    return new Promise((resolve) => {
      const args = ['-v', 'error', '-t', '1', '-i', mediaPath, '-f', 'null', '-'];
      const proc = spawn(this.ffmpegBin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let errOut = '';
      proc.stderr.on('data', (chunk) => {
        errOut += chunk.toString();
      });
      proc.on('close', (code) => {
        if (code === 0) resolve({ ok: true });
        else resolve({ ok: false, error: errOut || `ffmpeg exited with code ${code}` });
      });
      proc.on('error', (err) => resolve({ ok: false, error: err.message }));
    });
  }

  async requestStop(): Promise<void> {
    await this.stopFfmpeg('stopped');
  }

  private async safePoll(): Promise<void> {
    try {
      await this.pollOnce();
    } catch (error) {
      this.logger.error(`poll error: ${(error as Error).message}`);
    }
  }

  private async pollOnce(): Promise<void> {
    const { rows } = await this.pg.query<EncoderJobRow>(
      `SELECT livestream_id, desired_state, media_path, rtmp_url, backup_rtmp_url, stream_key, seek_to, profile_id, current_video_index, current_media_id
       FROM encoder_jobs
       WHERE desired_state = 'running'
       ORDER BY updated_at DESC
       LIMIT 1`,
    );

    if (!rows.length) {
      if (this.currentProcess) await this.stopFfmpeg('stopped');
      return;
    }

    const job = rows[0];
    const dualIngest = !!job.backup_rtmp_url;
    const targetRtmpBase =
      this.nodeName === 'backup' ? job.backup_rtmp_url || job.rtmp_url : job.rtmp_url;
    if (!targetRtmpBase || !job.stream_key) return;

    if (!dualIngest) {
      const lockKey = this.uuidToLockKey(job.livestream_id);
      const lockResult = await this.pg.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock($1::bigint) AS locked',
        [lockKey],
      );
      if (!lockResult.rows[0]?.locked) {
        if (this.currentLivestreamId === job.livestream_id && this.currentProcess) {
          await this.stopFfmpeg('standby');
        }
        return;
      }
      this.currentLockKey = lockKey;
    } else if (this.currentLockKey) {
      await this.pg.query('SELECT pg_advisory_unlock($1::bigint)', [this.currentLockKey]).catch(() => undefined);
      this.currentLockKey = null;
    }

    let targetMediaPath = job.media_path;
    let targetMediaId = job.current_media_id;
    let profileMediaIds: string[] = [];
    let targetMediaIndex = 0;

    if (job.profile_id) {
      profileMediaIds = await this.loadProfileMediaIds(job.profile_id);
      if (!profileMediaIds.length) return;

      let nextIndex =
        Number.isInteger(job.current_video_index) && job.current_video_index !== null
          ? job.current_video_index
          : 0;
      nextIndex = Math.max(0, nextIndex % profileMediaIds.length);

      if (
        this.currentLivestreamId === job.livestream_id &&
        this.currentStatus === 'completed' &&
        !this.currentProcess
      ) {
        const currentIdx =
          this.currentMediaId && profileMediaIds.includes(this.currentMediaId)
            ? profileMediaIds.indexOf(this.currentMediaId)
            : profileMediaIds.indexOf(job.current_media_id || '');
        const base = currentIdx >= 0 ? currentIdx : nextIndex;
        nextIndex = (base + 1) % profileMediaIds.length;
        targetMediaId = profileMediaIds[nextIndex];
        this.logger.log(
          `Next media selected for livestream=${job.livestream_id}: index=${nextIndex}, mediaId=${targetMediaId}`,
        );
        await this.pg.query(
          'UPDATE encoder_jobs SET current_video_index = $1, current_media_id = $2 WHERE livestream_id = $3',
          [nextIndex, targetMediaId, job.livestream_id],
        );
      }

      if (!targetMediaId || !profileMediaIds.includes(targetMediaId)) {
        targetMediaId = profileMediaIds[nextIndex];
        await this.pg.query(
          'UPDATE encoder_jobs SET current_video_index = $1, current_media_id = $2 WHERE livestream_id = $3',
          [nextIndex, targetMediaId, job.livestream_id],
        );
      }
      targetMediaIndex = profileMediaIds.indexOf(targetMediaId);
      if (this.prefetchEnabled && profileMediaIds.length > 0) {
        const safeIndex = targetMediaIndex >= 0 ? targetMediaIndex : 0;
        const nextIndex = (safeIndex + 1) % profileMediaIds.length;
        const nextMediaId = profileMediaIds[nextIndex];
        if (nextMediaId && nextMediaId !== targetMediaId) {
          this.prefetchMedia(nextMediaId);
        }

        const keepMediaIds = new Set(profileMediaIds);
        if (targetMediaId) keepMediaIds.add(targetMediaId);
        this.cleanupStaleCache(keepMediaIds);
      }

      const localPath = await this.ensureMediaLocalPath(targetMediaId);
      targetMediaPath = localPath;
    }

    const shouldRestart =
      !this.currentProcess ||
      this.currentLivestreamId !== job.livestream_id ||
      this.currentStatus !== 'running' ||
      this.currentMediaPath !== targetMediaPath ||
      this.currentOutputRtmpUrl !== targetRtmpBase;

    if (shouldRestart && targetMediaPath) {
      this.startFfmpeg({
        mediaPath: targetMediaPath,
        mediaId: targetMediaId,
        streamKey: job.stream_key,
        rtmpUrl: targetRtmpBase,
        seekTo: job.seek_to || '00:00:00.000',
        livestreamId: job.livestream_id,
      });
    }

    await this.updateHeartbeat();
  }

  private startFfmpeg(params: {
    mediaPath: string;
    mediaId: string | null;
    streamKey: string;
    rtmpUrl: string;
    seekTo: string;
    livestreamId: string;
  }): void {
    if (this.currentProcess) {
      this.currentProcess.kill('SIGTERM');
      this.currentProcess = null;
    }

    const args: string[] = [];
    if (params.seekTo && params.seekTo !== '00:00:00.000') args.push('-ss', params.seekTo);
    args.push(
      '-re',
      '-i',
      params.mediaPath,
      '-c:v',
      'copy',
      '-c:a',
      'copy',
      '-f',
      'flv',
      `${params.rtmpUrl}/${params.streamKey}`,
    );

    const proc = spawn(this.ffmpegBin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    this.logger.log(
      `Media start on node=${this.nodeName}, livestream=${params.livestreamId}, mediaId=${params.mediaId ?? 'unknown'}, seekTo=${params.seekTo}, output=${params.rtmpUrl}/${params.streamKey}`,
    );
    this.currentProcess = proc;
    this.currentStatus = 'running';
    this.currentLivestreamId = params.livestreamId;
    this.currentMediaPath = params.mediaPath;
    this.currentOutputRtmpUrl = params.rtmpUrl;
    this.currentMediaId = params.mediaId;
    this.currentTimestampStr = params.seekTo;
    this.currentTimestampMs = this.parseTimestampToMs(params.seekTo);
    this.stderrBuffer = '';

    proc.stderr?.on('data', (chunk) => {
      this.stderrBuffer += chunk.toString();
      this.parseFfmpegProgress(this.stderrBuffer);
      if (this.stderrBuffer.length > 8192) this.stderrBuffer = this.stderrBuffer.slice(-4096);
    });

    proc.on('close', (code) => {
      this.logger.log(
        `Media finished on node=${this.nodeName}, livestream=${params.livestreamId}, mediaId=${params.mediaId ?? 'unknown'}, exitCode=${code ?? 'null'}`,
      );
      this.currentStatus = code === 0 ? 'completed' : 'crashed';
      this.currentProcess = null;
    });
  }

  private async stopFfmpeg(reason: EngineStatus): Promise<void> {
    if (this.currentProcess) {
      this.currentProcess.kill('SIGTERM');
      this.currentProcess = null;
    }
    this.currentStatus = reason;
    this.currentLivestreamId = null;
    this.currentMediaPath = null;
    this.currentOutputRtmpUrl = null;
    this.currentMediaId = null;
    this.currentTimestampMs = 0;
    this.currentTimestampStr = '00:00:00.000';
    this.currentFrames = 0;
    this.currentBitrate = '0kbits/s';
    this.currentSpeed = '0x';
    if (this.currentLockKey) {
      await this.pg.query('SELECT pg_advisory_unlock($1::bigint)', [this.currentLockKey]).catch(() => undefined);
      this.currentLockKey = null;
    }
  }

  private async updateHeartbeat(): Promise<void> {
    if (!this.currentLivestreamId) return;
    await this.pg.query(
      `UPDATE encoder_jobs
       SET active_node = $1,
           last_heartbeat_at = NOW(),
           current_timestamp_ms = $2,
           current_timestamp_str = $3,
           current_media_id = $4
       WHERE livestream_id = $5`,
      [
        this.nodeName,
        this.currentTimestampMs,
        this.currentTimestampStr,
        this.currentMediaId,
        this.currentLivestreamId,
      ],
    );
  }

  private async loadProfileMediaIds(profileId: string): Promise<string[]> {
    const { rows } = await this.pg.query<{ profile_data: Record<string, unknown> }>(
      'SELECT to_jsonb(livestream_profiles) AS profile_data FROM livestream_profiles WHERE id = $1 LIMIT 1',
      [profileId],
    );
    if (!rows.length) return [];
    const data = rows[0].profile_data || {};
    const candidates = [
      data.video_media_ids,
      data.videoMediaIds,
      data.video_media_id ? [data.video_media_id] : null,
      data.videoMediaId ? [data.videoMediaId] : null,
    ];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        return candidate.filter((x): x is string => typeof x === 'string' && x.length > 0);
      }
    }
    return [];
  }

  private async loadMediaStorageKey(mediaId: string): Promise<string | null> {
    const cached = this.mediaStorageKeyCache.get(mediaId);
    if (cached) return cached;
    const { rows } = await this.pg.query<{ media_data: Record<string, unknown> }>(
      'SELECT to_jsonb(media_files) AS media_data FROM media_files WHERE id = $1 LIMIT 1',
      [mediaId],
    );
    if (!rows.length) return null;
    const data = rows[0].media_data || {};
    if (data.status !== 'ready') return null;
    const storageKey = (data.storageKey as string) || (data.storage_key as string) || null;
    if (storageKey) this.mediaStorageKeyCache.set(mediaId, storageKey);
    return storageKey;
  }

  private async ensureMediaLocalPath(mediaId: string): Promise<string | null> {
    const storageKey = await this.loadMediaStorageKey(mediaId);
    if (!storageKey) return null;
    const sourcePath = `/data/media/${storageKey}`;
    if (!this.prefetchEnabled) return sourcePath;

    const cachePath = this.getCachePath(mediaId, storageKey);
    if (await this.isFileReady(cachePath)) return cachePath;
    void this.prefetchMedia(mediaId);
    return sourcePath;
  }

  private prefetchMedia(mediaId: string): Promise<void> {
    if (!this.prefetchEnabled) return Promise.resolve();
    const existing = this.prefetchTasks.get(mediaId);
    if (existing) return existing;
    const task = this.prefetchMediaInternal(mediaId).finally(() => {
      this.prefetchTasks.delete(mediaId);
    });
    this.prefetchTasks.set(mediaId, task);
    return task;
  }

  private async prefetchMediaInternal(mediaId: string): Promise<void> {
    const storageKey = await this.loadMediaStorageKey(mediaId);
    if (!storageKey) return;
    const sourcePath = `/data/media/${storageKey}`;
    const targetPath = this.getCachePath(mediaId, storageKey);
    if (await this.isFileReady(targetPath)) {
      if (this.prefetchLogSkips) {
        this.logger.log(`Prefetch skip (already cached): mediaId=${mediaId}`);
      }
      return;
    }
    await mkdir(this.cacheDir, { recursive: true });
    const tempPath = `${targetPath}.tmp`;
    try {
      await pipeline(createReadStream(sourcePath), createWriteStream(tempPath));
      await rm(targetPath, { force: true });
      await this.renameSafe(tempPath, targetPath);
      this.logger.log(`Prefetch done: mediaId=${mediaId}`);
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined);
      this.logger.warn(
        `Prefetch failed mediaId=${mediaId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async cleanupStaleCache(keepMediaIds: Set<string>): Promise<void> {
    if (!this.prefetchEnabled) return;
    const entries = await readdir(this.cacheDir, { withFileTypes: true }).catch(() => []);
    const keepPrefixes = new Set(Array.from(keepMediaIds).map((id) => `${id}__`));
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const name = entry.name;
      if (!name.includes('__')) continue;
      const isKeep = Array.from(keepPrefixes).some((prefix) => name.startsWith(prefix));
      if (isKeep) continue;
      await rm(join(this.cacheDir, name), { force: true }).catch(() => undefined);
    }
    for (const mediaId of Array.from(this.mediaStorageKeyCache.keys())) {
      if (!keepMediaIds.has(mediaId)) {
        this.mediaStorageKeyCache.delete(mediaId);
      }
    }
  }

  private getCachePath(mediaId: string, storageKey: string): string {
    const fileName = `${mediaId}__${basename(storageKey)}`;
    return join(this.cacheDir, fileName);
  }

  private async isFileReady(filePath: string): Promise<boolean> {
    try {
      await access(filePath);
      const info = await stat(filePath);
      return info.isFile() && info.size > 0;
    } catch {
      return false;
    }
  }

  private async renameSafe(fromPath: string, toPath: string): Promise<void> {
    await rename(fromPath, toPath);
  }

  private parseFfmpegProgress(data: string): void {
    for (const line of data.split('\n')) {
      const timeMatch = line.match(/time=(\d+:\d+:\d+\.\d+)/);
      if (timeMatch) {
        this.currentTimestampStr = timeMatch[1];
        this.currentTimestampMs = this.parseTimestampToMs(timeMatch[1]);
      }
      const frameMatch = line.match(/frame=\s*(\d+)/);
      if (frameMatch) this.currentFrames = Number(frameMatch[1]);
      const bitrateMatch = line.match(/bitrate=\s*([\d.]+kbits\/s)/);
      if (bitrateMatch) this.currentBitrate = bitrateMatch[1];
      const speedMatch = line.match(/speed=\s*([\d.]+x)/);
      if (speedMatch) this.currentSpeed = speedMatch[1];
    }
  }

  private parseTimestampToMs(timeStr: string): number {
    const match = timeStr.match(/(\d+):(\d+):(\d+)\.(\d+)/);
    if (!match) return 0;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    const millis = Number(match[4].padEnd(3, '0').slice(0, 3));
    return hours * 3600000 + minutes * 60000 + seconds * 1000 + millis;
  }

  private uuidToLockKey(uuid: string): string {
    const hex = uuid.replace(/-/g, '').slice(0, 16);
    const value = BigInt(`0x${hex}`);
    return BigInt.asIntN(63, value).toString();
  }

  private async connectWithRetry(): Promise<void> {
    while (true) {
      try {
        await this.pg.connect();
        return;
      } catch (error) {
        this.logger.error(`db connect failed: ${(error as Error).message}`);
        await this.pg.end().catch(() => undefined);
        this.pg = this.createPgClient();
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }
}
