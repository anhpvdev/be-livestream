import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { LivestreamProfile } from './entities/livestream-profile.entity';
import {
  AddProfileVideoDto,
  CreateLivestreamProfileDto,
  ReorderProfileVideosDto,
  UpdateLivestreamProfileDto,
} from './dto/livestream-profile.dto';
import { MediaService } from '../media/media.service';
import { MediaFileKind, MediaFileStatus } from '../media/entities/media.entity';
import {
  Livestream,
  PrivacyStatus,
  LivestreamStatus,
} from '../livestream/entities/livestream.entity';
import { ProfileLiveSyncService } from './profile-live-sync.service';
import type { ProfileYoutubeSyncDelta } from './profile-youtube-sync.types';

@Injectable()
export class LivestreamProfileService {
  private readonly logger = new Logger(LivestreamProfileService.name);

  constructor(
    @InjectRepository(LivestreamProfile)
    private readonly profileRepo: Repository<LivestreamProfile>,
    @InjectRepository(Livestream)
    private readonly livestreamRepo: Repository<Livestream>,
    private readonly mediaService: MediaService,
    private readonly profileLiveSync: ProfileLiveSyncService,
  ) {}

  async createProfile(
    dto: CreateLivestreamProfileDto,
  ): Promise<LivestreamProfile> {
    for (const id of dto.videoMediaIds) {
      await this.validateVideoId(id);
    }
    if (dto.thumbnailMediaId) {
      await this.validateThumbnailMediaId(dto.thumbnailMediaId);
    }

    const profile = this.profileRepo.create({
      name: dto.name.trim(),
      description: dto.description ?? null,
      videoMediaIds: dto.videoMediaIds,
      livestreamTitle: dto.livestreamTitle?.trim() ?? null,
      livestreamDescription: dto.livestreamDescription ?? null,
      livestreamTags: dto.livestreamTags?.trim() ? dto.livestreamTags.trim() : null,
      thumbnailMediaId: dto.thumbnailMediaId ?? null,
      privacyStatus: dto.privacyStatus ?? PrivacyStatus.UNLISTED,
    });
    return this.profileRepo.save(profile);
  }

  async updateProfile(
    id: string,
    dto: UpdateLivestreamProfileDto,
  ): Promise<LivestreamProfile> {
    const profile = await this.findById(id);
    const beforeYoutube = this.snapshotYoutubeRelevantFields(profile);

    if (dto.name !== undefined) {
      profile.name = dto.name.trim();
    }
    if (dto.description !== undefined) {
      profile.description = dto.description;
    }
    if (dto.livestreamTitle !== undefined) {
      profile.livestreamTitle = dto.livestreamTitle.trim();
    }
    if (dto.livestreamDescription !== undefined) {
      profile.livestreamDescription = dto.livestreamDescription;
    }
    if (dto.livestreamTags !== undefined) {
      profile.livestreamTags = dto.livestreamTags.trim() ? dto.livestreamTags.trim() : null;
    }
    if (dto.thumbnailMediaId !== undefined) {
      if (dto.thumbnailMediaId) {
        await this.validateThumbnailMediaId(dto.thumbnailMediaId);
      }
      profile.thumbnailMediaId = dto.thumbnailMediaId;
    }
    if (dto.privacyStatus !== undefined) {
      profile.privacyStatus = dto.privacyStatus;
    }

    const saved = await this.profileRepo.save(profile);

    const afterYoutube = this.snapshotYoutubeRelevantFields(saved);
    const delta: ProfileYoutubeSyncDelta = {
      video:
        beforeYoutube.resolvedTitle !== afterYoutube.resolvedTitle ||
        beforeYoutube.resolvedDesc !== afterYoutube.resolvedDesc ||
        beforeYoutube.tagsRaw !== afterYoutube.tagsRaw,
      broadcast:
        beforeYoutube.resolvedTitle !== afterYoutube.resolvedTitle ||
        beforeYoutube.resolvedDesc !== afterYoutube.resolvedDesc ||
        beforeYoutube.privacy !== afterYoutube.privacy,
      thumbnail:
        beforeYoutube.thumbnailMediaId !== afterYoutube.thumbnailMediaId,
    };

    if (delta.video || delta.broadcast || delta.thumbnail) {
      void this.profileLiveSync
        .syncActiveLivestreamsAfterProfileUpdate(saved, delta)
        .catch((err: unknown) => {
          this.logger.error(
            `Đồng bộ profile → livestream thất bại: ${err instanceof Error ? err.message : String(err)}`,
            err instanceof Error ? err.stack : undefined,
          );
        });
    }

    return saved;
  }

  /** Cùng logic hiển thị với đồng bộ YouTube / start livestream. */
  private snapshotYoutubeRelevantFields(p: LivestreamProfile): {
    resolvedTitle: string;
    resolvedDesc: string;
    tagsRaw: string;
    privacy: PrivacyStatus;
    thumbnailMediaId: string | null;
  } {
    return {
      resolvedTitle: p.livestreamTitle?.trim() ?
          p.livestreamTitle.trim()
        : p.name.trim(),
      resolvedDesc: p.livestreamDescription ?? p.description ?? '',
      tagsRaw: p.livestreamTags?.trim() ?? '',
      privacy: p.privacyStatus,
      thumbnailMediaId: p.thumbnailMediaId,
    };
  }

  async listProfiles(): Promise<LivestreamProfile[]> {
    return this.profileRepo.find({ order: { createdAt: 'DESC' } });
  }

  async findById(id: string): Promise<LivestreamProfile> {
    const profile = await this.profileRepo.findOne({ where: { id } });
    if (!profile) {
      throw new NotFoundException(`Livestream profile ${id} not found`);
    }
    return profile;
  }

  async addVideo(
    id: string,
    dto: AddProfileVideoDto,
  ): Promise<LivestreamProfile> {
    await this.validateVideoId(dto.mediaId);
    const profile = await this.findById(id);
    if (!profile.videoMediaIds.includes(dto.mediaId)) {
      profile.videoMediaIds = [...profile.videoMediaIds, dto.mediaId];
    }
    return this.profileRepo.save(profile);
  }

  async removeVideo(id: string, mediaId: string): Promise<LivestreamProfile> {
    const profile = await this.findById(id);
    profile.videoMediaIds = profile.videoMediaIds.filter((x) => x !== mediaId);
    return this.profileRepo.save(profile);
  }

  async reorderVideos(
    id: string,
    dto: ReorderProfileVideosDto,
  ): Promise<LivestreamProfile> {
    const profile = await this.findById(id);
    const uniqueIds = Array.from(new Set(dto.mediaIds));
    if (uniqueIds.length !== dto.mediaIds.length) {
      throw new BadRequestException('Danh sách mediaIds không được trùng');
    }

    for (const mediaId of uniqueIds) {
      if (!profile.videoMediaIds.includes(mediaId)) {
        throw new BadRequestException(
          `Media ${mediaId} không thuộc profile ${id}, không thể reorder`,
        );
      }
    }

    profile.videoMediaIds = uniqueIds;
    return this.profileRepo.save(profile);
  }

  async removeProfile(id: string): Promise<void> {
    const profile = await this.findById(id);

    const activeLivestreamCount = await this.livestreamRepo.count({
      where: {
        profileId: id,
        status: In([LivestreamStatus.LIVE, LivestreamStatus.TESTING]),
      },
    });
    if (activeLivestreamCount > 0) {
      throw new ConflictException(
        'Không thể xóa profile đang gắn với livestream LIVE/TESTING',
      );
    }

    await this.profileRepo.remove(profile);
  }

  private async validateVideoId(videoId: string): Promise<void> {
    const media = await this.mediaService.findById(videoId);
    if (media.status !== MediaFileStatus.READY) {
      throw new BadRequestException(`Media ${videoId} is not ready`);
    }
    // if (media.kind !== MediaFileKind.VIDEO) {
    //   throw new BadRequestException(`Media ${videoId} must be video`);
    // }
    await this.mediaService.assertRtmpCopyCompatible(videoId);
  }

  private async validateThumbnailMediaId(mediaId: string): Promise<void> {
    const media = await this.mediaService.findById(mediaId);
    if (media.status !== MediaFileStatus.READY) {
      throw new BadRequestException(`Thumbnail media ${mediaId} is not ready`);
    }
    if (media.kind !== MediaFileKind.IMAGE) {
      throw new BadRequestException(`Thumbnail media ${mediaId} must be image`);
    }
  }
}
