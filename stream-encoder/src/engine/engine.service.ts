import * as os from 'node:os';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn, ChildProcess } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Client } from 'pg';
import { EncoderVpsBindingService } from './encoder-vps-binding.service';
import { EngineIdentityService } from './engine-identity.service';
import { EncoderJobRow, EngineStatus } from './engine.types';

type OwnershipState = {
  isOwner: boolean;
  ownerEpoch: number | null;
};

@Injectable()
export class EngineService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EngineService.name);
  private readonly nodeName: string;
  private readonly pollMs: number;
  private readonly ffmpegBin: string;
  private readonly prefetchEnabled: boolean;
  private readonly prefetchLogSkips: boolean;
  private readonly cacheDir: string;
  private readonly ownerLeaseMs: number;
  private readonly outputFps: number;
  private readonly outputGopSec: number;
  private readonly outputVideoBitrateKbps: number;
  private readonly outputMaxrateKbps: number;
  private readonly outputBufsizeKbps: number;
  private readonly outputAudioBitrateKbps: number;
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
  private processRunId = 0;
  private readonly mediaStorageKeyCache = new Map<string, string>();
  private readonly prefetchTasks = new Map<string, Promise<void>>();
  /** mediaId đã xác nhận có file cache hoàn chỉnh (tránh gọi pipeline copy lại khi loop / poll lặp). */
  private readonly mediaCacheCompleteIds = new Set<string>();

  constructor(
    private readonly config: ConfigService,
    identity: EngineIdentityService,
    private readonly encoderVpsBinding: EncoderVpsBindingService,
  ) {
    this.nodeName = identity.nodeId;
    this.pollMs = this.config.get<number>('ENGINE_DB_POLL_MS', 2000);
    this.ffmpegBin = this.config.get<string>('ENGINE_FFMPEG_BIN', 'ffmpeg');
    this.prefetchEnabled = this.config.get<string>('ENGINE_PREFETCH_ENABLED', 'true') === 'true';
    this.prefetchLogSkips =
      this.config.get<string>('ENGINE_PREFETCH_LOG_SKIPS', 'false') === 'true';
    this.cacheDir = this.config.get<string>('ENGINE_CACHE_DIR', '/tmp/encoder-cache');
    this.ownerLeaseMs = this.config.get<number>('ENGINE_OWNER_LEASE_MS', 6000);
    this.outputFps = this.config.get<number>('ENGINE_OUTPUT_FPS', 30);
    this.outputGopSec = this.config.get<number>('ENGINE_OUTPUT_GOP_SEC', 2);
    this.outputVideoBitrateKbps = this.config.get<number>('ENGINE_OUTPUT_VIDEO_BITRATE_KBPS', 6800);
    this.outputMaxrateKbps = this.config.get<number>('ENGINE_OUTPUT_MAXRATE_KBPS', 6800);
    this.outputBufsizeKbps = this.config.get<number>('ENGINE_OUTPUT_BUFSIZE_KBPS', 13600);
    this.outputAudioBitrateKbps = this.config.get<number>('ENGINE_OUTPUT_AUDIO_BITRATE_KBPS', 128);

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
    await this.ensureOwnershipColumns();
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
    const mem = process.memoryUsage();
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
      host: {
        loadavg: os.loadavg(),
        freemem: os.freemem(),
        totalmem: os.totalmem(),
        process_rss_mb: Math.round(mem.rss / 1024 / 1024),
        gpu: null as null,
      },
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
    const vpsId = this.encoderVpsBinding.encoderVpsId;
    const { rows } = await this.pg.query<EncoderJobRow>(
      `SELECT j.livestream_id, j.desired_state, j.media_path, j.rtmp_url, j.backup_rtmp_url, j.stream_key, j.seek_to, j.seek_mode, j.profile_id, j.current_video_index, j.current_media_id, j.playlist_generation, j.owner_node, j.owner_epoch, j.lease_until, j.start_current_media_at,
              (CASE WHEN j.start_current_media_at IS NULL THEN NULL
                    ELSE GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - j.start_current_media_at)) * 1000))::double precision
               END) AS wall_elapsed_ms,
              j.current_timestamp_ms, j.current_timestamp_str
       FROM encoder_jobs j
       INNER JOIN livestreams ls ON ls.id = j.livestream_id
       WHERE j.desired_state = 'running'
         AND (
           ($1::uuid IS NOT NULL AND (ls.primary_encoder_vps_id = $1 OR ls.backup_encoder_vps_id = $1))
           OR ($1 IS NULL AND ls.primary_encoder_vps_id IS NULL AND ls.backup_encoder_vps_id IS NULL)
         )
       ORDER BY j.updated_at DESC
       LIMIT 1`,
      [vpsId],
    );

    if (!rows.length) {
      if (this.currentProcess) await this.stopFfmpeg('stopped');
      return;
    }

    const job = rows[0];
    const dualIngest = !!job.backup_rtmp_url;
    // Với dual ingest: luôn phải xác định node nào đang giữ quyền authority.
    const ownership = await this.acquireOrRenewOwnership(job, dualIngest);
    let isPlaylistController = !dualIngest || ownership.isOwner;
    const ownerEpoch = ownership.ownerEpoch;
    /** Chỉ owner (hoặc single-ingest đã giữ lock) được ghi playback state xuống encoder_jobs. */
    const canWritePlaybackState = !dualIngest || ownership.isOwner;
    let targetRtmpBase = job.rtmp_url;
    if (!job.stream_key) return;

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
    } else {
      if (this.currentLockKey) {
        await this.pg
          .query('SELECT pg_advisory_unlock($1::bigint)', [this.currentLockKey])
          .catch(() => undefined);
        this.currentLockKey = null;
      }
      if (ownership.isOwner) {
        targetRtmpBase = job.rtmp_url;
      } else {
        // Dual-ingest theo control-plane mới: chỉ owner được phép phát để tránh split-brain/đè luồng.
        // Follower chỉ poll DB, giữ standby và chờ takeover khi lease owner hết hạn.
        if (this.currentLivestreamId === job.livestream_id && this.currentProcess) {
          await this.stopFfmpeg('standby');
        }
        return;
      }
    }
    if (!targetRtmpBase) return;

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

      // Chỉ authority mới được quyền "advance" playlist khi bài hiện tại đã phát xong (exit 0, không còn process).
      // Bài kế phải đủ điều kiện phát (cache xong nếu bật prefetch) — nếu chưa thì loop bài hiện tại, không CAS sang bài sau.
      const shouldAdvanceNow =
        isPlaylistController &&
        this.currentLivestreamId === job.livestream_id &&
        this.currentStatus === 'completed' &&
        !this.currentProcess;
      if (shouldAdvanceNow) {
        const currentIdx =
          this.currentMediaId && profileMediaIds.includes(this.currentMediaId)
            ? profileMediaIds.indexOf(this.currentMediaId)
            : profileMediaIds.indexOf(job.current_media_id || '');
        const base = currentIdx >= 0 ? currentIdx : nextIndex;
        const candidateNextIndex = (base + 1) % profileMediaIds.length;
        const candidateNextId = profileMediaIds[candidateNextIndex];
        const nextReady = await this.isMediaPlaybackReady(candidateNextId);
        if (!nextReady) {
          this.logger.warn(
            `Bài kế chưa sẵn sàng để phát (chờ prefetch/cache), giữ bài hiện tại — livestream=${job.livestream_id}, nextMediaId=${candidateNextId}`,
          );
          void this.prefetchMedia(candidateNextId);
        } else {
          nextIndex = candidateNextIndex;
          targetMediaId = candidateNextId;
          this.logger.log(
            `Next media selected for livestream=${job.livestream_id}: index=${nextIndex}, mediaId=${targetMediaId}`,
          );
          const updated = await this.updatePlaylistCursor(
            job.livestream_id,
            nextIndex,
            targetMediaId,
            (job.playlist_generation ?? 0) + 1,
            dualIngest,
            ownerEpoch,
          );
          if (!updated) {
            // Mất quyền ghi cursor (fencing fail) -> fallback follower.
            isPlaylistController = false;
            targetMediaId = job.current_media_id;
          }
        }
      }

      if (!targetMediaId || !profileMediaIds.includes(targetMediaId)) {
        targetMediaId = profileMediaIds[nextIndex];
        if (isPlaylistController) {
          const updated = await this.updatePlaylistCursor(
            job.livestream_id,
            nextIndex,
            targetMediaId,
            (job.playlist_generation ?? 0) + 1,
            dualIngest,
            ownerEpoch,
          );
          if (!updated) {
            // Tránh split-brain: nếu không ghi được CAS thì không tự quyết định bài.
            isPlaylistController = false;
            if (!job.current_media_id) return;
            targetMediaId = job.current_media_id;
          }
        } else if (!job.current_media_id) {
          return;
        }
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

      let localPath = await this.ensureMediaLocalPath(targetMediaId);
      // Giữ cố định đường dẫn input trong suốt một phiên ffmpeg (tránh đổi source -> cache làm restart giữa bài).
      if (
        this.currentProcess &&
        this.currentLivestreamId === job.livestream_id &&
        targetMediaId &&
        this.currentMediaId === targetMediaId &&
        this.currentMediaPath
      ) {
        localPath = this.currentMediaPath;
      }
      targetMediaPath = localPath;

    }

    const shouldRestart =
      !this.currentProcess ||
      this.currentLivestreamId !== job.livestream_id ||
      this.currentStatus !== 'running' ||
      this.currentMediaPath !== targetMediaPath ||
      this.currentOutputRtmpUrl !== targetRtmpBase;

    if (shouldRestart && targetMediaPath) {
      const isSwitchingMedia =
        !!this.currentMediaId &&
        !!targetMediaId &&
        this.currentMediaId !== targetMediaId;
      const effectiveSeekTo = this.resolveSeekTo(job, isSwitchingMedia);
      this.startFfmpeg({
        mediaPath: targetMediaPath,
        mediaId: targetMediaId,
        streamKey: job.stream_key,
        rtmpUrl: targetRtmpBase,
        seekTo: effectiveSeekTo,
        livestreamId: job.livestream_id,
      });
      if (canWritePlaybackState) {
        await this.touchStartCurrentMediaAtIfNeeded(
          job,
          isSwitchingMedia,
          dualIngest,
          ownerEpoch,
        );
      }
      if (job.seek_mode === 'failover' && canWritePlaybackState) {
        await this.consumeFailoverSeekMode(job.livestream_id);
      }
    }

    if (canWritePlaybackState) {
      await this.updateHeartbeat(isPlaylistController, dualIngest, ownerEpoch);
    }
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
    const gopFrames = Math.max(1, Math.floor(this.outputFps * this.outputGopSec));
    if (params.seekTo && params.seekTo !== '00:00:00.000') args.push('-ss', params.seekTo);
    args.push(
      '-re',
      '-i',
      params.mediaPath,
      '-r',
      String(this.outputFps),
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-tune',
      'zerolatency',
      '-pix_fmt',
      'yuv420p',
      '-x264-params',
      `keyint=${gopFrames}:min-keyint=${gopFrames}:scenecut=0`,
      '-g',
      String(gopFrames),
      '-keyint_min',
      String(gopFrames),
      '-b:v',
      `${this.outputVideoBitrateKbps}k`,
      '-maxrate',
      `${this.outputMaxrateKbps}k`,
      '-bufsize',
      `${this.outputBufsizeKbps}k`,
      '-c:a',
      'aac',
      '-b:a',
      `${this.outputAudioBitrateKbps}k`,
      '-ar',
      '48000',
      '-ac',
      '2',
      '-af',
      'aresample=async=1:min_hard_comp=0.100:first_pts=0',
      '-f',
      'flv',
      `${params.rtmpUrl}/${params.streamKey}`,
    );

    const proc = spawn(this.ffmpegBin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    const runId = ++this.processRunId;
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
      // Bỏ qua callback "close" cũ khi process đã bị thay bằng phiên mới.
      if (this.currentProcess !== proc || runId !== this.processRunId) {
        return;
      }
      this.logger.log(
        `Media finished on node=${this.nodeName}, livestream=${params.livestreamId}, mediaId=${params.mediaId ?? 'unknown'}, exitCode=${code ?? 'null'}`,
      );
      this.currentStatus = code === 0 ? 'completed' : 'crashed';
      this.currentProcess = null;
      // Reconcile ngay khi process kết thúc để giảm gap giữa 2 bài (không phải chờ kỳ poll kế tiếp).
      void this.safePoll();
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

  private async updateHeartbeat(
    shouldUpdateMediaCursor: boolean,
    dualIngest: boolean,
    ownerEpoch: number | null,
  ): Promise<void> {
    if (!this.currentLivestreamId) return;
    await this.pg.query(
      `UPDATE encoder_jobs
       SET active_node = $1,
           last_heartbeat_at = NOW(),
           current_timestamp_ms = $2,
           current_timestamp_str = $3,
           -- Chỉ authority hợp lệ mới được ghi đè current_media_id trong dual-ingest.
           current_media_id = CASE
             WHEN $6 AND (NOT $7 OR (owner_node::text = $9 AND owner_epoch = $8))
             THEN $4
             ELSE current_media_id
           END
       WHERE livestream_id = $5`,
      [
        this.nodeName,
        this.currentTimestampMs,
        this.currentTimestampStr,
        this.currentMediaId,
        this.currentLivestreamId,
        shouldUpdateMediaCursor,
        dualIngest,
        ownerEpoch,
        this.nodeName,
      ],
    );
  }

  /**
   * Dual-ingest: mọi node đều có thể UPDATE để giành lease khi hết hạn (failover).
   * Đây là ngoại lệ duy nhất cho "backup": không ghi heartbeat/cursor, chỉ bầu owner.
   * Muốn user DB read-only thuần túy cần hàm SECURITY DEFINER hoặc queue riêng.
   */
  private async acquireOrRenewOwnership(
    job: EncoderJobRow,
    dualIngest: boolean,
  ): Promise<OwnershipState> {
    if (!dualIngest) return { isOwner: true, ownerEpoch: null };
    const livestreamId = job.livestream_id;
    const result = await this.pg.query<{ owner_node: string; owner_epoch: number }>(
      `UPDATE encoder_jobs
       SET owner_node = $2,
           owner_epoch = CASE
             WHEN owner_node IS DISTINCT FROM $2 THEN COALESCE(owner_epoch, 0) + 1
             ELSE COALESCE(owner_epoch, 1)
           END,
           lease_until = NOW() + ($3 || ' milliseconds')::interval
       WHERE livestream_id = $1
         AND (
           owner_node = $2
           OR owner_node IS NULL
           OR lease_until IS NULL
           OR lease_until < NOW()
         )
       RETURNING owner_node, owner_epoch`,
      [
        livestreamId,
        this.nodeName,
        this.ownerLeaseMs,
      ],
    );
    if (result.rowCount && result.rows[0]) {
      return {
        isOwner: result.rows[0].owner_node === this.nodeName,
        ownerEpoch: result.rows[0].owner_epoch ?? null,
      };
    }
    return {
      isOwner: job.owner_node === this.nodeName,
      ownerEpoch: job.owner_epoch ?? null,
    };
  }

  private async updatePlaylistCursor(
    livestreamId: string,
    nextIndex: number,
    targetMediaId: string,
    nextGeneration: number,
    dualIngest: boolean,
    ownerEpoch: number | null,
  ): Promise<boolean> {
    if (!dualIngest) {
      await this.pg.query(
        'UPDATE encoder_jobs SET current_video_index = $1, current_media_id = $2, playlist_generation = $3 WHERE livestream_id = $4',
        [nextIndex, targetMediaId, nextGeneration, livestreamId],
      );
      return true;
    }

    // Dual ingest: CAS theo owner + epoch + generation để chặn ghi đè sai node.
    const result = await this.pg.query(
      `UPDATE encoder_jobs
       SET current_video_index = $1, current_media_id = $2, playlist_generation = $3
       WHERE livestream_id = $4
         AND owner_node = $5
         AND owner_epoch = $6
         AND playlist_generation = $7`,
      [
        nextIndex,
        targetMediaId,
        nextGeneration,
        livestreamId,
        this.nodeName,
        ownerEpoch,
        nextGeneration - 1,
      ],
    );
    return (result.rowCount ?? 0) > 0;
  }

  private async consumeFailoverSeekMode(livestreamId: string): Promise<void> {
    await this.pg.query(
      `UPDATE encoder_jobs
       SET seek_mode = 'normal'
       WHERE livestream_id = $1`,
      [livestreamId],
    );
  }

  /**
   * Ghi mốc wall-clock khi bắt đầu một media mới (chỉ được gọi khi canWritePlaybackState).
   * Không ghi đè khi takeover nếu main đã để lại start_current_media_at.
   */
  private async touchStartCurrentMediaAtIfNeeded(
    job: EncoderJobRow,
    isSwitchingMedia: boolean,
    dualIngest: boolean,
    ownerEpoch: number | null,
  ): Promise<void> {
    const needTouch =
      isSwitchingMedia ||
      (!!job.current_media_id && !job.start_current_media_at);
    if (!needTouch) return;

    if (!dualIngest) {
      await this.pg.query(
        `UPDATE encoder_jobs SET start_current_media_at = NOW() WHERE livestream_id = $1`,
        [job.livestream_id],
      );
      return;
    }
    await this.pg.query(
      `UPDATE encoder_jobs
       SET start_current_media_at = NOW()
       WHERE livestream_id = $1
         AND owner_node = $2
         AND owner_epoch = $3`,
      [job.livestream_id, this.nodeName, ownerEpoch],
    );
  }

  private async ensureOwnershipColumns(): Promise<void> {
    await this.pg.query(
      `ALTER TABLE encoder_jobs
         ALTER COLUMN active_node TYPE varchar(128)`,
    );
    await this.pg.query(
      `ALTER TABLE encoder_jobs
         ADD COLUMN IF NOT EXISTS owner_node varchar(128) NULL`,
    );
    await this.pg.query(
      `ALTER TABLE encoder_jobs
         ALTER COLUMN owner_node TYPE varchar(128)`,
    );
    await this.pg.query(
      `ALTER TABLE encoder_jobs
         ADD COLUMN IF NOT EXISTS owner_epoch int NULL`,
    );
    await this.pg.query(
      `ALTER TABLE encoder_jobs
         ADD COLUMN IF NOT EXISTS lease_until timestamptz NULL`,
    );
    await this.pg.query(
      `ALTER TABLE encoder_jobs
         ADD COLUMN IF NOT EXISTS playlist_generation int NOT NULL DEFAULT 0`,
    );
    await this.pg.query(
      `ALTER TABLE encoder_jobs
         ADD COLUMN IF NOT EXISTS seek_to varchar(32) NULL`,
    );
    await this.pg.query(
      `ALTER TABLE encoder_jobs
         ADD COLUMN IF NOT EXISTS seek_mode varchar(16) NOT NULL DEFAULT 'normal'`,
    );
    await this.pg.query(
      `ALTER TABLE encoder_jobs
         ADD COLUMN IF NOT EXISTS start_current_media_at timestamptz NULL`,
    );
  }

  private resolveSeekTo(job: EncoderJobRow, isSwitchingMedia: boolean): string {
    if (isSwitchingMedia) {
      return '00:00:00.000';
    }
    // Khi vừa hoàn tất clip trước đó, clip kế tiếp luôn phát từ đầu.
    if (
      this.currentLivestreamId === job.livestream_id &&
      this.currentStatus === 'completed' &&
      !this.currentProcess
    ) {
      return '00:00:00.000';
    }
    if (job.seek_mode === 'failover' && job.seek_to) {
      return job.seek_to;
    }
    // Cùng media, khởi động lại ffmpeg (takeover / crash): snapshot từ main qua DB.
    // wall_elapsed_ms tính trong PostgreSQL (NOW() − timestamptz): một mốc tuyệt đối, không phụ thuộc
    // Date.now() hay timezone OS của từng VPS encoder (tránh lệch khi 2 server khác múi giờ / lệch đồng hồ).
    const dbMs = Number(job.current_timestamp_ms ?? 0);
    const wallMs =
      job.wall_elapsed_ms != null && Number.isFinite(Number(job.wall_elapsed_ms))
        ? Math.max(0, Number(job.wall_elapsed_ms))
        : 0;
    const effectiveMs = Math.max(dbMs, wallMs);
    if (effectiveMs <= 0) return '00:00:00.000';
    return this.msToTimestampStr(effectiveMs);
  }

  private msToTimestampStr(ms: number): string {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const milli = ms % 1000;
    const pad = (n: number, w: number) => n.toString().padStart(w, '0');
    return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}.${pad(milli, 3)}`;
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

    if (await this.isMediaDownloadedToCache(mediaId, storageKey)) {
      return this.getCachePath(mediaId, storageKey);
    }
    void this.prefetchMedia(mediaId);
    return sourcePath;
  }

  /**
   * Kiểm tra bài đã có bản copy đầy đủ trong cache chưa (loop lần 2 → chỉ đọc file có sẵn, không copy lại).
   * Luôn verify bằng stat trên đĩa; nếu file mất thì gỡ khỏi Set để lần sau prefetch lại được.
   */
  private async isMediaDownloadedToCache(
    mediaId: string,
    storageKeyHint?: string | null,
  ): Promise<boolean> {
    if (!this.prefetchEnabled) return false;
    const storageKey = storageKeyHint ?? (await this.loadMediaStorageKey(mediaId));
    if (!storageKey) {
      this.mediaCacheCompleteIds.delete(mediaId);
      return false;
    }
    const cachePath = this.getCachePath(mediaId, storageKey);
    const ok = await this.isFileReady(cachePath);
    if (ok) {
      this.mediaCacheCompleteIds.add(mediaId);
    } else {
      this.mediaCacheCompleteIds.delete(mediaId);
    }
    return ok;
  }

  /**
   * Điều kiện "được phép mở bài" khi chuyển playlist:
   * - Prefetch tắt: file nguồn trên volume phải tồn tại và size > 0.
   * - Prefetch bật: chỉ coi là sẵn sàng khi bản copy cache đã hoàn tất (tránh bài 2 tải dở đã chèn vào luồng).
   */
  private async isMediaPlaybackReady(mediaId: string): Promise<boolean> {
    if (this.prefetchEnabled) {
      return this.isMediaDownloadedToCache(mediaId);
    }
    const storageKey = await this.loadMediaStorageKey(mediaId);
    if (!storageKey) return false;
    return this.isFileReady(`/data/media/${storageKey}`);
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
    if (await this.isMediaDownloadedToCache(mediaId, storageKey)) {
      if (this.prefetchLogSkips) {
        this.logger.log(`Prefetch skip (đã có cache trên đĩa): mediaId=${mediaId}`);
      }
      return;
    }
    await mkdir(this.cacheDir, { recursive: true });
    const tempPath = `${targetPath}.tmp`;
    try {
      await pipeline(createReadStream(sourcePath), createWriteStream(tempPath));
      await rm(targetPath, { force: true });
      await this.renameSafe(tempPath, targetPath);
      this.mediaCacheCompleteIds.add(mediaId);
      this.logger.log(`Prefetch done: mediaId=${mediaId}`);
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined);
      this.mediaCacheCompleteIds.delete(mediaId);
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
      const sep = name.indexOf('__');
      if (sep > 0) {
        this.mediaCacheCompleteIds.delete(name.slice(0, sep));
      }
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
    const normalized = uuid.replace(/[^a-zA-Z0-9]/g, '');
    const hexBase =
      normalized.length > 0
        ? Buffer.from(normalized).toString('hex')
        : Buffer.from('lock').toString('hex');
    const hex = hexBase.slice(0, 16).padEnd(16, '0');
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
