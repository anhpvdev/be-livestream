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
import { EncoderHealthResponse } from '../encoder/dto/encoder-status.dto';
import { EncoderNode } from '../encoder/entities/encoder-session.entity';
import { StartLivestreamDto } from './dto/start-livestream.dto';
import { BroadcastSegmentService } from './broadcast-segment.service';
import { LivestreamProfileService } from '../livestream-profile/livestream-profile.service';
import { GetLivestreamStatusQueryDto } from './dto/get-livestream-status-query.dto';
import {
  LivestreamEncoderHealthDto,
  LivestreamStatusProfileDto,
  LivestreamStatusResponseDto,
  StartLivestreamAckDto,
} from './dto/livestream-response.dto';
import { YouTubeLivestreamOrchestratorService } from '../youtube-api/youtube-livestream-orchestrator.service';
import { EncoderJob } from '../encoder/entities/encoder-job.entity';
import { EncoderVpsService } from '../encoder/encoder-vps.service';
import { parseCommaSeparatedTags } from '../youtube-api/youtube-tags.util';

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
    private readonly encoderVpsService: EncoderVpsService,
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

    this.assertEncoderVpsPair(dto);
    await this.encoderVpsService.assertUsablePair(
      dto.primaryEncoderVpsId,
      dto.backupEncoderVpsId,
    );

    const livestream = this.livestreamRepo.create({
      googleAccountId: dto.googleAccountId,
      mediaFileId: media.id,
      profileId: dto.profileId,
      primaryEncoderVpsId: dto.primaryEncoderVpsId,
      backupEncoderVpsId: dto.backupEncoderVpsId,
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

    try {
      this.assertEncoderVpsPair(dto);
    } catch (error) {
      return {
        ok: false,
        checks,
        message: error.message ?? 'Invalid encoder VPS selection',
      };
    }

    await this.encoderVpsService.assertUsablePair(
      dto.primaryEncoderVpsId,
      dto.backupEncoderVpsId,
    );
    const [pu, bu] = await Promise.all([
      this.encoderVpsService.getResolvedBaseUrl(dto.primaryEncoderVpsId),
      this.encoderVpsService.getResolvedBaseUrl(dto.backupEncoderVpsId),
    ]);
    if (!pu || !bu) {
      return {
        ok: false,
        checks,
        message: 'Không resolve được base URL cho một trong hai VPS encoder.',
      };
    }

    const [primaryHealth, backupHealth] = await Promise.all([
      this.encoderService.getHealthAtUrl(pu),
      this.encoderService.getHealthAtUrl(bu),
    ]);

    checks.encoderPrimaryReachable = !!primaryHealth;
    checks.encoderBackupReachable = !!backupHealth;

    if (!checks.encoderPrimaryReachable || !checks.encoderBackupReachable) {
      return {
        ok: false,
        checks,
        message:
          'Encoder health check failed trên một hoặc hai VPS đã chọn. Kiểm tra baseUrl và port stream-encoder.',
      };
    }

    const [primaryProbe, backupProbe] = await Promise.all([
      this.encoderService.probeMediaWithFfmpegAtUrl(pu, mediaPath),
      this.encoderService.probeMediaWithFfmpegAtUrl(bu, mediaPath),
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

    await this.encoderService.startEncoder(
      livestream,
      media,
      EncoderNode.PRIMARY,
      livestream.profileId ?? null,
    );
    this.encoderHealthService.startMonitoring(
      livestream.id,
      EncoderNode.PRIMARY,
    );

    livestream.status = LivestreamStatus.LIVE;
    await this.livestreamRepo.save(livestream);

    this.logger.log(`Livestream ${id} resumed`);
    return livestream;
  }

  async getStatus(
    id: string,
    query: GetLivestreamStatusQueryDto = {},
  ): Promise<LivestreamStatusResponseDto> {
    const livestream = await this.findById(id);

    const populateMedia = query.populate_media === true;
    const populateProfile = populateMedia || query.populate_profile === true;

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

    const [primaryHealth, backupHealth] = await Promise.all([
      this.encoderService.getHealth(EncoderNode.PRIMARY, id),
      this.encoderService.getHealth(EncoderNode.BACKUP, id),
    ]);
    const normalizedPrimaryHealth = this.toAdminHealth(primaryHealth);
    const normalizedBackupHealth = this.toAdminHealth(backupHealth);

    const [primaryVpsRow, backupVpsRow] = await Promise.all([
      livestream.primaryEncoderVpsId
        ? this.encoderVpsService.findById(livestream.primaryEncoderVpsId)
        : Promise.resolve(null),
      livestream.backupEncoderVpsId
        ? this.encoderVpsService.findById(livestream.backupEncoderVpsId)
        : Promise.resolve(null),
    ]);
    // Identity node của từng role cấu hình (VPS -> encoder_node), fallback health.node khi thiếu mapping.
    const configuredPrimaryNodeIdentity =
      primaryVpsRow?.encoderNode ?? normalizedPrimaryHealth?.node ?? null;
    const configuredBackupNodeIdentity =
      backupVpsRow?.encoderNode ?? normalizedBackupHealth?.node ?? null;
    // Runtime authority trong DB: owner_node, fallback active_node (do stream-encoder ghi).
    // Chỉ trả về khi khớp một trong hai node đã gán primary/backup — tránh hiển thị node lạ/stale (vd. job cũ hoặc process encoder thứ ba cùng DB).
    const playlistAuthorityRaw =
      encoderJob?.ownerNode ?? encoderJob?.activeNode ?? null;
    const playlistAuthorityNode =
      playlistAuthorityRaw &&
      (playlistAuthorityRaw === configuredPrimaryNodeIdentity ||
        playlistAuthorityRaw === configuredBackupNodeIdentity)
        ? playlistAuthorityRaw
        : null;
    const isPrimaryAuthority =
      !!playlistAuthorityNode &&
      !!configuredPrimaryNodeIdentity &&
      playlistAuthorityNode === configuredPrimaryNodeIdentity;
    const isBackupAuthority =
      !!playlistAuthorityNode &&
      !!configuredBackupNodeIdentity &&
      playlistAuthorityNode === configuredBackupNodeIdentity;

    const { title: _omitTitle, description: _omitDesc, ...snapshot } =
      this.toResponse({ ...livestream, mediaFileId: playbackMediaId });

    let profile: LivestreamStatusProfileDto | null | undefined;
    if (populateProfile) {
      if (!livestream.profileId) {
        profile = null;
      } else {
        const p = await this.livestreamProfileService.findById(
          livestream.profileId,
        );
        const base: LivestreamStatusProfileDto = {
          id: p.id,
          name: p.name,
          description: p.description,
          videoMediaIds: p.videoMediaIds ?? [],
          livestreamTitle: p.livestreamTitle,
          livestreamDescription: p.livestreamDescription,
          livestreamTags: p.livestreamTags,
          thumbnailMediaId: p.thumbnailMediaId,
          privacyStatus: p.privacyStatus,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
        };
        if (populateMedia) {
          const videoIds = p.videoMediaIds ?? [];
          const videoFiles = await Promise.all(
            videoIds.map((vid) => this.mediaService.findById(vid)),
          );
          base.videoMedia = videoFiles.map((m) =>
            this.mediaService.toResponseDto(m),
          );
          if (p.thumbnailMediaId) {
            const thumb = await this.mediaService.findById(p.thumbnailMediaId);
            base.thumbnailMedia = this.mediaService.toResponseDto(thumb);
          } else {
            base.thumbnailMedia = null;
          }
        }
        profile = base;
      }
    }

    return {
      ...snapshot,
      ...(populateProfile ? { profile } : {}),
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
      youtubeBroadcastStatus,
      encoderNodes: {
        primary: {
          encoderVpsId: livestream.primaryEncoderVpsId,
          vpsName: primaryVpsRow?.name ?? null,
          resolvedBaseUrl:
            livestream.primaryEncoderVpsId ? (primaryVpsRow?.baseUrl ?? null) : null,
          health: normalizedPrimaryHealth ?? null,
          isPlaylistAuthority: isPrimaryAuthority,
        },
        backup: {
          encoderVpsId: livestream.backupEncoderVpsId,
          vpsName: backupVpsRow?.name ?? null,
          resolvedBaseUrl:
            livestream.backupEncoderVpsId ? (backupVpsRow?.baseUrl ?? null) : null,
          health: normalizedBackupHealth ?? null,
          isPlaylistAuthority: isBackupAuthority,
        },
        playlistAuthorityNode,
      },
    };
  }

  async findAll(status?: LivestreamStatus): Promise<Livestream[]> {
    const where = status ? { status } : undefined;
    return this.livestreamRepo.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  async removeAllLivestreams(): Promise<void> {
    const all = await this.livestreamRepo.find({
      select: ['id', 'status'],
    });
    for (const ls of all) {
      if (
        ls.status === LivestreamStatus.LIVE ||
        ls.status === LivestreamStatus.TESTING
      ) {
        await this.encoderService.stopEncoder(ls.id).catch(() => undefined);
        this.encoderHealthService.stopMonitoring(ls.id);
      }
      await this.livestreamRepo.delete({ id: ls.id });
    }
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
      primaryEncoderVpsId: ls.primaryEncoderVpsId,
      backupEncoderVpsId: ls.backupEncoderVpsId,
      currentSegmentId: ls.currentSegmentId,
      title: ls.title,
      description: ls.description,
      youtubeBroadcastId: ls.youtubeBroadcastId,
      youtubeStreamId: ls.youtubeStreamId,
      status: ls.status,
      privacyStatus: ls.privacyStatus,
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

  private toAdminHealth(
    health: EncoderHealthResponse | null,
  ): LivestreamEncoderHealthDto | null {
    if (!health) return null;
    return {
      node: health.node ?? null,
      status: health.status ?? null,
      livestreamId: health.livestreamId ?? null,
      timestampStr: health.timestamp_str ?? null,
      bitrate: health.bitrate ?? null,
      pid: health.pid ?? null,
    };
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

  private assertEncoderVpsPair(dto: StartLivestreamDto): void {
    if (dto.primaryEncoderVpsId === dto.backupEncoderVpsId) {
      throw new BadRequestException(
        'primaryEncoderVpsId và backupEncoderVpsId phải là hai VPS khác nhau.',
      );
    }
  }

  private async resolveYoutubeSession(dto: StartLivestreamDto) {
    const profile = await this.livestreamProfileService.findById(dto.profileId);

    if (!profile.livestreamTitle) {
      throw new BadRequestException(
        'Profile chưa có livestreamTitle, vui lòng cập nhật profile trước khi start',
      );
    }

    const tags = parseCommaSeparatedTags(profile.livestreamTags);

    // Mỗi lần start sẽ tạo broadcast + stream mới, không tái sử dụng broadcast cũ.
    return this.youtubeOrchestrator.createAndBindBroadcast(dto.googleAccountId, {
      title: profile.livestreamTitle,
      description: profile.livestreamDescription ?? undefined,
      scheduledStartTime: new Date(),
      privacyStatus: profile.privacyStatus || PrivacyStatus.UNLISTED,
      tags: tags.length ? tags : undefined,
    });
  }
}
