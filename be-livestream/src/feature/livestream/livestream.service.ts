import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Livestream,
  LivestreamStatus,
  PrivacyStatus,
} from './entities/livestream.entity';
import { LivestreamProgress } from './entities/livestream-progress.entity';
import { GoogleAccountService } from '../google-account/google-account.service';
import { MediaService } from '../media/media.service';
import { MediaFileKind, MediaFileStatus } from '../media/entities/media.entity';
import { EncoderService } from '../encoder/encoder.service';
import { EncoderHealthService } from '../encoder/encoder-health.service';
import { EncoderNode } from '../encoder/entities/encoder-session.entity';
import { StartLivestreamDto } from './dto/start-livestream.dto';
import { BroadcastSegmentService } from './broadcast-segment.service';
import { LivestreamProfileService } from '../livestream-profile/livestream-profile.service';
import { StartLivestreamAckDto } from './dto/livestream-response.dto';
import { YouTubeLivestreamOrchestratorService } from '../youtube-api/youtube-livestream-orchestrator.service';
import { EncoderJob } from '../encoder/entities/encoder-job.entity';

type LivestreamPreflightResult = {
  ok: boolean;
  checks: {
    googleAccount: boolean;
    profile: boolean;
    mediaReady: boolean;
    encoderPrimaryReachable: boolean;
    encoderBackupReachable: boolean;
    encoderPrimaryFfmpegProbe: boolean;
    encoderBackupFfmpegProbe: boolean;
  };
  message: string;
};

@Injectable()
export class LivestreamService {
  private readonly logger = new Logger(LivestreamService.name);

  constructor(
    @InjectRepository(Livestream)
    private readonly livestreamRepo: Repository<Livestream>,
    @InjectRepository(LivestreamProgress)
    private readonly progressRepo: Repository<LivestreamProgress>,
    @InjectRepository(EncoderJob)
    private readonly encoderJobRepo: Repository<EncoderJob>,
    private readonly googleAccountService: GoogleAccountService,
    private readonly mediaService: MediaService,
    private readonly youtubeOrchestrator: YouTubeLivestreamOrchestratorService,
    private readonly encoderService: EncoderService,
    private readonly encoderHealthService: EncoderHealthService,
    private readonly broadcastSegmentService: BroadcastSegmentService,
    private readonly livestreamProfileService: LivestreamProfileService,
  ) {}

  async startLivestream(
    dto: StartLivestreamDto,
  ): Promise<StartLivestreamAckDto> {
    const preflight = await this.preflightStart(dto);
    if (!preflight.ok) {
      throw new BadRequestException(preflight.message);
    }
    const { profile, media } = await this.resolveStartContext(dto);
    const youtubeSession = await this.resolveYoutubeSession(dto);

    if (profile.thumbnailMediaId) {
      // Thumbnail lấy từ media storage nội bộ rồi upload trực tiếp lên YouTube.
      const thumbnailMedia = await this.mediaService.findById(
        profile.thumbnailMediaId,
      );
      if (thumbnailMedia.status !== MediaFileStatus.READY) {
        throw new BadRequestException(
          `Thumbnail media ${thumbnailMedia.id} is not ready`,
        );
      }
      if (thumbnailMedia.kind !== MediaFileKind.IMAGE) {
        throw new BadRequestException(
          `Thumbnail media ${thumbnailMedia.id} must be image`,
        );
      }
      const thumbnailBuffer = await this.mediaService.getMediaBuffer(
        thumbnailMedia.id,
      );
      await this.youtubeOrchestrator.setBroadcastThumbnail(
        dto.googleAccountId,
        youtubeSession.broadcastId,
        thumbnailBuffer,
        thumbnailMedia.mimeType,
      );
    }

    const livestream = this.livestreamRepo.create({
      googleAccountId: dto.googleAccountId,
      mediaFileId: media.id,
      profileId: dto.profileId,
      title: profile.livestreamTitle || profile.name,
      description: profile.livestreamDescription || profile.description,
      youtubeBroadcastId: youtubeSession.broadcastId,
      youtubeStreamId: youtubeSession.stream.streamId,
      youtubeStreamKey: youtubeSession.stream.streamKey,
      youtubeRtmpUrl: youtubeSession.stream.rtmpUrl,
      youtubeBackupRtmpUrl: youtubeSession.stream.backupRtmpUrl,
      privacyStatus: profile.privacyStatus || PrivacyStatus.UNLISTED,
      status: LivestreamStatus.CREATED,
    });
    const saved = await this.livestreamRepo.save(livestream);

    await this.broadcastSegmentService.recordInitialSegment({
      livestream: saved,
    });

    try {
      await this.encoderService.startEncoder(
        saved,
        media,
        '00:00:00.000',
        EncoderNode.PRIMARY,
        profile.id,
      );
      this.encoderHealthService.startMonitoring(saved.id, EncoderNode.PRIMARY);
      saved.status = LivestreamStatus.TESTING;
      saved.actualStartTime = new Date();
      await this.livestreamRepo.save(saved);
    } catch (err) {
      this.encoderHealthService.stopMonitoring(saved.id);
      saved.status = LivestreamStatus.ERROR;
      await this.livestreamRepo.save(saved);
      this.logger.error(`Failed to start livestream: ${err.message}`);
      throw err;
    }

    void this.promoteLivestreamToLive(saved.id);

    return {
      message: 'Da khoi dong livestream thanh cong',
      livestreamId: saved.id,
      youtubeStreamId: saved.youtubeStreamId,
      youtubeBroadcastId: saved.youtubeBroadcastId,
      watchUrl: saved.youtubeBroadcastId
        ? `https://www.youtube.com/watch?v=${saved.youtubeBroadcastId}`
        : null,
      status: saved.status,
    };
  }

  async preflightStart(
    dto: StartLivestreamDto,
  ): Promise<LivestreamPreflightResult> {
    const checks = {
      googleAccount: false,
      profile: false,
      mediaReady: false,
      encoderPrimaryReachable: false,
      encoderBackupReachable: false,
      encoderPrimaryFfmpegProbe: false,
      encoderBackupFfmpegProbe: false,
    };

    let mediaPath = '';
    try {
      const { media } = await this.resolveStartContext(dto);
      mediaPath = `/data/media/${media.storageKey}`;
      checks.googleAccount = true;
      checks.profile = true;
      checks.mediaReady = true;
    } catch (error) {
      return {
        ok: false,
        checks,
        message: error.message ?? 'Invalid account/profile/media',
      };
    }

    const [primaryHealth, backupHealth] = await Promise.all([
      this.encoderService.getHealth(EncoderNode.PRIMARY),
      this.encoderService.getHealth(EncoderNode.BACKUP),
    ]);

    checks.encoderPrimaryReachable = !!primaryHealth;
    checks.encoderBackupReachable = !!backupHealth;

    if (!checks.encoderPrimaryReachable || !checks.encoderBackupReachable) {
      return {
        ok: false,
        checks,
        message:
          'Encoder health check failed. Verify ENCODER_PRIMARY_URL/ENCODER_BACKUP_URL and docker ports.',
      };
    }

    const [primaryProbe, backupProbe] = await Promise.all([
      this.encoderService.probeMediaWithFfmpeg(EncoderNode.PRIMARY, mediaPath),
      this.encoderService.probeMediaWithFfmpeg(EncoderNode.BACKUP, mediaPath),
    ]);
    checks.encoderPrimaryFfmpegProbe = primaryProbe;
    checks.encoderBackupFfmpegProbe = backupProbe;

    if (!primaryProbe || !backupProbe) {
      return {
        ok: false,
        checks,
        message:
          'Encoder ffmpeg probe failed to read media file. Verify media mount path and file availability in both encoder containers.',
      };
    }

    return {
      ok: true,
      checks,
      message: 'Preflight passed',
    };
  }

  async stopLivestream(id: string): Promise<Livestream> {
    const livestream = await this.findById(id);

    if (
      livestream.status !== LivestreamStatus.LIVE &&
      livestream.status !== LivestreamStatus.TESTING
    ) {
      throw new BadRequestException('Livestream is not currently active');
    }

    await this.encoderService.stopEncoder(livestream.id);
    this.encoderHealthService.stopMonitoring(livestream.id);

    try {
      await this.youtubeOrchestrator.transitionBroadcast(
        livestream.googleAccountId,
        livestream.youtubeBroadcastId,
        'complete',
      );
    } catch (err) {
      this.logger.warn(
        `Failed to transition broadcast to complete: ${err.message}`,
      );
    }

    livestream.status = LivestreamStatus.STOPPED;
    livestream.actualEndTime = new Date();
    return this.livestreamRepo.save(livestream);
  }

  async resumeLivestream(id: string): Promise<Livestream> {
    const livestream = await this.findById(id);

    if (
      livestream.status !== LivestreamStatus.ERROR &&
      livestream.status !== LivestreamStatus.STOPPED
    ) {
      throw new BadRequestException(
        'Livestream cannot be resumed from current state',
      );
    }

    if (!livestream.mediaFileId) {
      throw new BadRequestException(
        'Livestream has no media file; resume is not supported',
      );
    }

    const media = await this.mediaService.findById(livestream.mediaFileId);

    const progress = await this.progressRepo.findOne({
      where: { livestreamId: id },
      order: { updatedAt: 'DESC' },
    });

    const seekTo = progress?.currentTimestampStr || '00:00:00.000';

    await this.encoderService.startEncoder(
      livestream,
      media,
      seekTo,
      EncoderNode.PRIMARY,
      livestream.profileId ?? null,
    );
    this.encoderHealthService.startMonitoring(
      livestream.id,
      EncoderNode.PRIMARY,
    );

    livestream.status = LivestreamStatus.LIVE;
    await this.livestreamRepo.save(livestream);

    this.logger.log(`Livestream ${id} resumed from ${seekTo}`);
    return livestream;
  }

  async getStatus(id: string) {
    const livestream = await this.findById(id);

    const activeSession = await this.encoderService.getActiveSession(id);

    const progressWhere =
      activeSession ?
        { livestreamId: id, encoderSessionId: activeSession.id }
      : { livestreamId: id };

    const progress = await this.progressRepo.findOne({
      where: progressWhere,
      order: { updatedAt: 'DESC' },
    });

    const encoderJob = await this.encoderJobRepo.findOne({
      where: { livestreamId: id },
    });

    let youtubeBroadcastStatus = 'unknown';
    try {
      youtubeBroadcastStatus =
        await this.youtubeOrchestrator.getBroadcastLifecycleStatus(
          livestream.googleAccountId,
          livestream.youtubeBroadcastId,
        );
    } catch {
      // non-critical
    }

    const playbackMediaId =
      encoderJob?.currentMediaId ?? livestream.mediaFileId ?? null;

    return {
      ...this.toResponse({ ...livestream, mediaFileId: playbackMediaId }),
      progress: progress
        ? {
            currentTimestampMs: this.coerceBigIntField(
              progress.currentTimestampMs,
            ),
            currentTimestampStr: progress.currentTimestampStr,
            framesProcessed: this.coerceBigIntFieldNullable(
              progress.framesProcessed,
            ),
            bytesProcessed: this.coerceBigIntFieldNullable(
              progress.bytesProcessed,
            ),
            currentBitrate: progress.currentBitrate ?? null,
            updatedAt: progress.updatedAt,
            encoderSessionId: progress.encoderSessionId,
          }
        : null,
      currentTimestampMs: this.coerceBigIntField(
        progress?.currentTimestampMs ?? 0,
      ),
      currentTimestampStr:
        progress?.currentTimestampStr ?? '00:00:00.000',
      encoderNode: activeSession?.encoderNode || null,
      youtubeBroadcastStatus,
      encoderJobActiveNode: encoderJob?.activeNode ?? null,
      encoderCurrentMediaId: encoderJob?.currentMediaId ?? null,
      encoderCurrentVideoIndex: encoderJob?.currentVideoIndex ?? null,
    };
  }

  async findAll(): Promise<Livestream[]> {
    return this.livestreamRepo.find({
      order: { createdAt: 'DESC' },
    });
  }

  async removeLivestream(id: string): Promise<void> {
    const livestream = await this.findById(id);
    await this.livestreamRepo.remove(livestream);
  }

  async findById(id: string): Promise<Livestream> {
    const livestream = await this.livestreamRepo.findOne({ where: { id } });
    if (!livestream) {
      throw new NotFoundException(`Livestream ${id} not found`);
    }
    return livestream;
  }

  toResponse(ls: Livestream) {
    return {
      id: ls.id,
      googleAccountId: ls.googleAccountId,
      currentMediaId: ls.mediaFileId,
      profileId: ls.profileId,
      currentSegmentId: ls.currentSegmentId,
      title: ls.title,
      description: ls.description,
      youtubeBroadcastId: ls.youtubeBroadcastId,
      youtubeStreamId: ls.youtubeStreamId,
      streamUrl: ls.youtubeRtmpUrl,
      youtubeBackupRtmpUrl: ls.youtubeBackupRtmpUrl,
      status: ls.status,
      privacyStatus: ls.privacyStatus,
      actualStartTime: ls.actualStartTime,
      actualEndTime: ls.actualEndTime,
      createdAt: ls.createdAt,
      updatedAt: ls.updatedAt,
    };
  }

  private coerceBigIntField(value: number | bigint): number {
    return typeof value === 'bigint' ? Number(value) : value;
  }

  private coerceBigIntFieldNullable(
    value: number | bigint | null | undefined,
  ): number | null {
    if (value === null || value === undefined) return null;
    return typeof value === 'bigint' ? Number(value) : value;
  }

  private async promoteLivestreamToLive(livestreamId: string): Promise<void> {
    try {
      const livestream = await this.findById(livestreamId);
      await this.youtubeOrchestrator.waitForStreamReady(
        livestream.googleAccountId,
        livestream.youtubeStreamId,
      );
      // Luồng hiện tại đi thẳng sang live sau khi stream active.
      await this.youtubeOrchestrator.transitionBroadcast(
        livestream.googleAccountId,
        livestream.youtubeBroadcastId,
        'live',
      );

      livestream.status = LivestreamStatus.LIVE;
      await this.livestreamRepo.save(livestream);
      this.logger.log(`Livestream ${livestream.id} is now LIVE`);
    } catch (error) {
      this.logger.error(
        `Background transition failed for livestream ${livestreamId}: ${error.message}`,
      );
      const livestream = await this.livestreamRepo.findOne({
        where: { id: livestreamId },
      });
      if (livestream) {
        livestream.status = LivestreamStatus.ERROR;
        await this.livestreamRepo.save(livestream);
      }
    }
  }

  private async resolveStartContext(dto: StartLivestreamDto) {
    // Bước này chỉ xác thực dữ liệu đầu vào trước khi start.
    await this.googleAccountService.findById(dto.googleAccountId);
    const profile = await this.livestreamProfileService.findById(dto.profileId);
    if (!profile.videoMediaIds || profile.videoMediaIds.length === 0) {
      throw new BadRequestException('Profile must contain at least one video');
    }
    const media = await this.mediaService.findById(profile.videoMediaIds[0]);
    if (media.status !== MediaFileStatus.READY) {
      throw new BadRequestException(
        `Profile video ${profile.videoMediaIds[0]} is not ready`,
      );
    }

    return { profile, media };
  }

  private async resolveYoutubeSession(dto: StartLivestreamDto) {
    const profile = await this.livestreamProfileService.findById(dto.profileId);

    if (!profile.livestreamTitle) {
      throw new BadRequestException(
        'Profile chưa có livestreamTitle, vui lòng cập nhật profile trước khi start',
      );
    }

    // Mỗi lần start sẽ tạo broadcast + stream mới, không tái sử dụng broadcast cũ.
    return this.youtubeOrchestrator.createAndBindBroadcast(dto.googleAccountId, {
      title: profile.livestreamTitle,
      description: profile.livestreamDescription ?? undefined,
      scheduledStartTime: new Date(),
      privacyStatus: profile.privacyStatus || PrivacyStatus.UNLISTED,
    });
  }
}
