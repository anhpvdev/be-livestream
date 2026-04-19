import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EncoderService } from './encoder.service';
import { EncoderNode } from './entities/encoder-session.entity';
import { LivestreamProgress } from '../livestream/entities/livestream-progress.entity';
import { AppEnv } from '@/core/config/app-configs';

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
    private readonly configService: ConfigService<AppEnv>,
    @InjectRepository(LivestreamProgress)
    private readonly progressRepo: Repository<LivestreamProgress>,
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
    const currentNode = monitor.currentNode;
    const fallbackNode = this.getBackupNode(currentNode);
    const inGracePeriod = Date.now() < monitor.graceUntilMs;
    const health = await this.encoderService.getHealth(
      monitor.currentNode,
      livestreamId,
    );

    if (!health || health.status !== 'running') {
      // Vừa start: primary có thể còn idle vài giây (poll DB + spawn ffmpeg).
      if (inGracePeriod) {
        return;
      }

      const fallbackHealth = await this.encoderService.getHealth(
        fallbackNode,
        livestreamId,
      );
      const fallbackServesThisLivestream =
        fallbackHealth?.status === 'running' &&
        fallbackHealth.livestreamId === livestreamId;

      if (fallbackServesThisLivestream) {
        if (monitor.currentNode !== fallbackNode) {
          this.logger.warn(
            `Monitor node switched to [${fallbackNode}] because [${currentNode}] is not running`,
          );
        }
        monitor.currentNode = fallbackNode;
        monitor.missCount = 0;
        monitor.graceUntilMs = Date.now() + this.startupGraceMs;
        await this.updateProgress(livestreamId, fallbackHealth);
        return;
      }
      monitor.missCount++;
      this.logger.warn(
        `Encoder [${monitor.currentNode}] miss #${monitor.missCount} for livestream ${livestreamId}`,
      );

      if (monitor.missCount >= this.failoverThreshold) {
        this.logger.warn(
          `Không trigger failover từ BE. Chờ worker takeover theo DB lease — livestream=${livestreamId}, currentNode=${monitor.currentNode}, fallbackNode=${fallbackNode}`,
        );
        monitor.currentNode = fallbackNode;
        monitor.missCount = 0;
        monitor.graceUntilMs = Date.now() + this.startupGraceMs;
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

  private getBackupNode(current: EncoderNode): EncoderNode {
    return current === EncoderNode.PRIMARY
      ? EncoderNode.BACKUP
      : EncoderNode.PRIMARY;
  }
}
