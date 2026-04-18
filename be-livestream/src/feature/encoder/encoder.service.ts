import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  EncoderSession,
  EncoderNode,
  EncoderSessionStatus,
} from './entities/encoder-session.entity';
import { EncoderDesiredState, EncoderJob } from './entities/encoder-job.entity';
import { Livestream } from '../livestream/entities/livestream.entity';
import { MediaFile } from '../media/entities/media.entity';
import { AppEnv } from '@/core/config/app-configs';
import { EncoderHealthResponse } from './dto/encoder-status.dto';

@Injectable()
export class EncoderService {
  private readonly logger = new Logger(EncoderService.name);
  private readonly primaryUrl: string;
  private readonly backupUrl: string;

  constructor(
    @InjectRepository(EncoderSession)
    private readonly sessionRepo: Repository<EncoderSession>,
    @InjectRepository(EncoderJob)
    private readonly jobRepo: Repository<EncoderJob>,
    private readonly configService: ConfigService<AppEnv>,
  ) {
    this.primaryUrl = this.configService.get('ENCODER_PRIMARY_URL');
    this.backupUrl = this.configService.get('ENCODER_BACKUP_URL');
  }

  async startEncoder(
    livestream: Livestream,
    media: MediaFile,
    seekTo = '00:00:00.000',
    node: EncoderNode = EncoderNode.PRIMARY,
    profileId: string | null = null,
  ): Promise<EncoderSession> {
    const payload = {
      mediaPath: `/data/media/${media.storageKey}`,
      rtmpUrl: livestream.youtubeRtmpUrl,
      backupRtmpUrl: livestream.youtubeBackupRtmpUrl,
      streamKey: livestream.youtubeStreamKey,
      seekTo,
      currentMediaId: media.id,
    };
    await this.enqueueRunJob(livestream.id, payload, profileId);

    const session = this.sessionRepo.create({
      livestreamId: livestream.id,
      encoderNode: node,
      status: EncoderSessionStatus.RUNNING,
      ffmpegPid: null,
      startedAt: new Date(),
    });

    await this.sessionRepo.save(session);
    this.logger.log(
      `Encoder [${node}] started for livestream ${livestream.id} (seek: ${seekTo})`,
    );

    return session;
  }

  async stopEncoder(livestreamId: string): Promise<void> {
    await this.enqueueStopJob(livestreamId);
    await Promise.all([
      this.sendStopToNode(this.primaryUrl),
      this.sendStopToNode(this.backupUrl),
    ]);

    const session = await this.getActiveSession(livestreamId);
    if (!session) return;

    session.status = EncoderSessionStatus.STOPPED;
    session.stoppedAt = new Date();
    await this.sessionRepo.save(session);
  }

  private async enqueueRunJob(
    livestreamId: string,
    payload: {
      mediaPath: string;
      rtmpUrl: string;
      backupRtmpUrl: string | null;
      streamKey: string;
      seekTo: string;
      currentMediaId: string | null;
    },
    profileId: string | null,
  ): Promise<void> {
    const current = await this.jobRepo.findOne({ where: { livestreamId } });
    const job = current ?? this.jobRepo.create({ livestreamId });

    job.desiredState = EncoderDesiredState.RUNNING;
    job.mediaPath = payload.mediaPath;
    job.rtmpUrl = payload.rtmpUrl;
    job.backupRtmpUrl = payload.backupRtmpUrl;
    job.streamKey = payload.streamKey;
    job.seekTo = payload.seekTo;
    job.profileId = profileId;
    job.currentVideoIndex = 0;
    job.currentMediaId = payload.currentMediaId;
    if (job.playlistGeneration === null || job.playlistGeneration === undefined) {
      job.playlistGeneration = 0;
    }

    await this.jobRepo.save(job);
  }

  private async enqueueStopJob(livestreamId: string): Promise<void> {
    const current = await this.jobRepo.findOne({ where: { livestreamId } });
    const job = current ?? this.jobRepo.create({ livestreamId });

    job.desiredState = EncoderDesiredState.STOPPED;
    job.activeNode = null;

    await this.jobRepo.save(job);
  }

  async getHealth(node: EncoderNode): Promise<EncoderHealthResponse | null> {
    const url = this.getNodeUrl(node);
    const timeoutMs = this.configService.get<number>(
      'ENCODER_HEALTH_TIMEOUT_MS',
    );

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(`${url}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) return null;
      return (await res.json()) as EncoderHealthResponse;
    } catch {
      return null;
    }
  }

  async probeMediaWithFfmpeg(
    node: EncoderNode,
    mediaPath: string,
  ): Promise<boolean> {
    const url = this.getNodeUrl(node);
    const timeoutMs = this.configService.get<number>(
      'ENCODER_HEALTH_TIMEOUT_MS',
    );

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(`${url}/probe-media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mediaPath }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return false;
      const payload = (await res.json()) as { ok?: boolean };
      return payload.ok === true;
    } catch {
      return false;
    }
  }

  async getActiveSession(livestreamId: string): Promise<EncoderSession | null> {
    return this.sessionRepo.findOne({
      where: {
        livestreamId,
        status: EncoderSessionStatus.RUNNING,
      },
      order: { createdAt: 'DESC' },
    });
  }

  async markSessionCrashed(sessionId: string, reason: string): Promise<void> {
    await this.sessionRepo.update(sessionId, {
      status: EncoderSessionStatus.CRASHED,
      stoppedAt: new Date(),
      crashReason: reason,
    });
  }

  async getAllSessionsForLivestream(
    livestreamId: string,
  ): Promise<EncoderSession[]> {
    return this.sessionRepo.find({
      where: { livestreamId },
      order: { createdAt: 'DESC' },
    });
  }

  async listJobs(): Promise<EncoderJob[]> {
    return this.jobRepo.find({
      order: { updatedAt: 'DESC' },
    });
  }

  async deleteJob(livestreamId: string): Promise<void> {
    const job = await this.jobRepo.findOne({ where: { livestreamId } });
    if (!job) return;

    if (job.desiredState === EncoderDesiredState.RUNNING) {
      await this.stopEncoder(livestreamId);
    }

    await this.jobRepo.delete({ livestreamId });
  }

  private getNodeUrl(node: EncoderNode): string {
    return node === EncoderNode.PRIMARY ? this.primaryUrl : this.backupUrl;
  }

  private async sendStopToNode(url: string): Promise<void> {
    const timeoutMs = this.configService.get<number>(
      'ENCODER_HEALTH_TIMEOUT_MS',
    );
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      await fetch(`${url}/stop`, {
        method: 'POST',
        signal: controller.signal,
      });
      clearTimeout(timer);
    } catch {
      // best effort only; DB desired_state vẫn là nguồn sự thật
    }
  }
}
