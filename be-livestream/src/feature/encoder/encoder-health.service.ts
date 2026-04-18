import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EncoderService } from './encoder.service';
import { EncoderNode } from './entities/encoder-session.entity';
import { LivestreamProgress } from '../livestream/entities/livestream-progress.entity';
import { AppEnv } from '@/core/config/app-configs';
import { EncoderFailoverService } from './encoder-failover.service';
import { Livestream } from '../livestream/entities/livestream.entity';
import { MediaFile } from '../media/entities/media.entity';
import { EncoderJob } from './entities/encoder-job.entity';

interface MonitoredStream {
  livestreamId: string;
  currentNode: EncoderNode;
  missCount: number;
  graceUntilMs: number;
}

@Injectable()
export class EncoderHealthService implements OnModuleDestroy {
  private readonly logger = new Logger(EncoderHealthService.name);
  private readonly monitoredStreams = new Map<string, MonitoredStream>();
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private readonly healthIntervalMs: number;
  private readonly failoverThreshold: number;
  private readonly startupGraceMs = 30000;

  constructor(
    private readonly encoderService: EncoderService,
    private readonly encoderFailoverService: EncoderFailoverService,
    private readonly configService: ConfigService<AppEnv>,
    @InjectRepository(LivestreamProgress)
    private readonly progressRepo: Repository<LivestreamProgress>,
    @InjectRepository(Livestream)
    private readonly livestreamRepo: Repository<Livestream>,
    @InjectRepository(MediaFile)
    private readonly mediaRepo: Repository<MediaFile>,
    @InjectRepository(EncoderJob)
    private readonly encoderJobRepo: Repository<EncoderJob>,
  ) {
    this.healthIntervalMs = this.configService.get<number>(
      'ENCODER_HEALTH_INTERVAL_MS',
    );
    this.failoverThreshold = this.configService.get<number>(
      'ENCODER_FAILOVER_THRESHOLD',
    );
  }

  startMonitoring(livestreamId: string, node: EncoderNode): void {
    this.monitoredStreams.set(livestreamId, {
      livestreamId,
      currentNode: node,
      missCount: 0,
      graceUntilMs: Date.now() + this.startupGraceMs,
    });

    if (!this.intervalHandle) {
      this.intervalHandle = setInterval(
        () => this.checkAll(),
        this.healthIntervalMs,
      );
      this.logger.log('Health monitoring loop started');
    }
  }

  stopMonitoring(livestreamId: string): void {
    this.monitoredStreams.delete(livestreamId);

    if (this.monitoredStreams.size === 0 && this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      this.logger.log('Health monitoring loop stopped (no active streams)');
    }
  }

  resetGrace(livestreamId: string, node?: EncoderNode): void {
    const monitor = this.monitoredStreams.get(livestreamId);
    if (!monitor) return;
    if (node) {
      monitor.currentNode = node;
    }
    monitor.missCount = 0;
    monitor.graceUntilMs = Date.now() + this.startupGraceMs;
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
    }
  }

  private async checkAll(): Promise<void> {
    for (const [livestreamId, monitor] of this.monitoredStreams) {
      try {
        await this.checkOne(livestreamId, monitor);
      } catch (err) {
        this.logger.error(
          `Health check error for ${livestreamId}: ${err.message}`,
        );
      }
    }
  }

  private async checkOne(
    livestreamId: string,
    monitor: MonitoredStream,
  ): Promise<void> {
    const health = await this.encoderService.getHealth(
      monitor.currentNode,
      livestreamId,
    );
    const inGracePeriod = Date.now() < monitor.graceUntilMs;

    if (!health || health.status !== 'running') {
      if (inGracePeriod) {
        return;
      }
      monitor.missCount++;
      this.logger.warn(
        `Encoder [${monitor.currentNode}] miss #${monitor.missCount} for livestream ${livestreamId}`,
      );

      if (monitor.missCount >= this.failoverThreshold) {
        const backupNode = this.getBackupNode(monitor.currentNode);
        const backupHealth = await this.encoderService.getHealth(
          backupNode,
          livestreamId,
        );
        if (backupHealth?.status === 'running') {
          this.logger.warn(
            `Primary node missed nhưng backup [${backupNode}] đang RUNNING, chuyển monitor sang backup`,
          );
          monitor.currentNode = backupNode;
          monitor.missCount = 0;
          monitor.graceUntilMs = Date.now() + this.startupGraceMs;
          return;
        }
        await this.triggerFailover(livestreamId, monitor);
      }
      return;
    }

    monitor.missCount = 0;

    await this.updateProgress(livestreamId, health);
  }

  private async updateProgress(
    livestreamId: string,
    health: any,
  ): Promise<void> {
    const session = await this.encoderService.getActiveSession(livestreamId);
    if (!session) return;

    let progress = await this.progressRepo.findOne({
      where: { livestreamId, encoderSessionId: session.id },
    });

    if (!progress) {
      progress = this.progressRepo.create({
        livestreamId,
        encoderSessionId: session.id,
      });
    }

    progress.currentTimestampMs = health.timestamp_ms;
    progress.currentTimestampStr = health.timestamp_str;
    progress.framesProcessed = health.frames;
    progress.currentBitrate = health.bitrate;

    await this.progressRepo.save(progress);
  }

  private async triggerFailover(
    livestreamId: string,
    monitor: MonitoredStream,
  ): Promise<void> {
    this.logger.warn(
      `FAILOVER triggered for livestream ${livestreamId}: [${monitor.currentNode}] -> [${this.getBackupNode(monitor.currentNode)}]`,
    );

    const activeSession =
      await this.encoderService.getActiveSession(livestreamId);
    if (activeSession) {
      await this.encoderService.markSessionCrashed(
        activeSession.id,
        `Health check missed ${this.failoverThreshold} times`,
      );
    }

    const progress = await this.progressRepo.findOne({
      where: { livestreamId },
      order: { updatedAt: 'DESC' },
    });
    const job = await this.encoderJobRepo.findOne({
      where: { livestreamId },
      select: ['currentTimestampStr', 'currentTimestampMs'],
    });
    const seekTo = this.pickBestSeekTo(
      progress?.currentTimestampStr ?? null,
      this.toNumber(progress?.currentTimestampMs),
      job?.currentTimestampStr ?? null,
      this.toNumber(job?.currentTimestampMs),
    );
    const backupNode = this.getBackupNode(monitor.currentNode);

    const livestream = await this.livestreamRepo.findOne({
      where: { id: livestreamId },
    });
    if (!livestream) {
      this.logger.error(
        `Failover aborted: livestream ${livestreamId} not found`,
      );
      return;
    }

    const media = await this.mediaRepo.findOne({
      where: { id: livestream.mediaFileId },
    });
    if (!media) {
      this.logger.error(
        `Failover aborted: media ${livestream.mediaFileId} not found`,
      );
      return;
    }

    try {
      await this.encoderFailoverService.executeFailover(
        livestream,
        media,
        monitor.currentNode,
        seekTo,
      );
      monitor.currentNode = backupNode;
      monitor.missCount = 0;
      monitor.graceUntilMs = Date.now() + this.startupGraceMs;

      this.logger.log(
        `Failover: starting [${backupNode}] encoder from ${seekTo}`,
      );
    } catch (err) {
      this.logger.error(`Failover failed: ${err.message}`);
    }
  }

  private getBackupNode(current: EncoderNode): EncoderNode {
    return current === EncoderNode.PRIMARY
      ? EncoderNode.BACKUP
      : EncoderNode.PRIMARY;
  }

  private pickBestSeekTo(
    progressStr: string | null,
    progressMs: number | null,
    jobStr: string | null,
    jobMs: number | null,
  ): string {
    const candidates = [
      { str: progressStr, ms: progressMs ?? this.parseTimestampToMs(progressStr) },
      { str: jobStr, ms: jobMs ?? this.parseTimestampToMs(jobStr) },
    ].filter((x): x is { str: string; ms: number } => !!x.str && Number.isFinite(x.ms ?? NaN));

    if (!candidates.length) return '00:00:00.000';
    candidates.sort((a, b) => b.ms - a.ms);
    return candidates[0].str;
  }

  private parseTimestampToMs(value: string | null): number | null {
    if (!value) return null;
    const match = value.match(/(\d+):(\d+):(\d+)\.(\d+)/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    const millis = Number(match[4].padEnd(3, '0').slice(0, 3));
    return hours * 3600000 + minutes * 60000 + seconds * 1000 + millis;
  }

  private toNumber(value: number | bigint | null | undefined): number | null {
    if (value === null || value === undefined) return null;
    return typeof value === 'bigint' ? Number(value) : value;
  }
}
