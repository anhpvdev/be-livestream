import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { LivestreamProfile } from './entities/livestream-profile.entity';
import { Livestream, LivestreamStatus } from '../livestream/entities/livestream.entity';
import { MediaFileKind, MediaFileStatus } from '../media/entities/media.entity';
import { MediaService } from '../media/media.service';
import { YouTubeLivestreamOrchestratorService } from '../youtube-api/youtube-livestream-orchestrator.service';
import { parseCommaSeparatedTags } from '../youtube-api/youtube-tags.util';
import type { ProfileYoutubeSyncDelta } from './profile-youtube-sync.types';

@Injectable()
export class ProfileLiveSyncService {
  private readonly logger = new Logger(ProfileLiveSyncService.name);

  constructor(
    @InjectRepository(Livestream)
    private readonly livestreamRepo: Repository<Livestream>,
    private readonly youtubeOrchestrator: YouTubeLivestreamOrchestratorService,
    private readonly mediaService: MediaService,
  ) {}

  /**
   * Sau khi cập nhật profile: đồng bộ lên YouTube chỉ các phần có thay đổi (delta).
   */
  async syncActiveLivestreamsAfterProfileUpdate(
    profile: LivestreamProfile,
    delta: ProfileYoutubeSyncDelta,
  ): Promise<void> {
    if (!delta.video && !delta.broadcast && !delta.thumbnail) {
      return;
    }

    const rows = await this.livestreamRepo.find({
      where: {
        profileId: profile.id,
        status: In([
          LivestreamStatus.CREATED,
          LivestreamStatus.TESTING,
          LivestreamStatus.LIVE,
        ]),
      },
    });

    const title =
      profile.livestreamTitle?.trim() ? profile.livestreamTitle.trim() : profile.name;
    const description =
      profile.livestreamDescription ?? profile.description ?? '';
    const tags = parseCommaSeparatedTags(profile.livestreamTags);
    const privacyStatus = profile.privacyStatus as
      | 'public'
      | 'unlisted'
      | 'private';

    let thumbnailPayload: { buffer: Buffer; mimeType: string } | undefined;
    if (delta.thumbnail && profile.thumbnailMediaId) {
      const thumb = await this.mediaService
        .findById(profile.thumbnailMediaId)
        .catch(() => null);
      if (
        thumb &&
        thumb.status === MediaFileStatus.READY &&
        thumb.kind === MediaFileKind.IMAGE
      ) {
        const buffer = await this.mediaService.getMediaBuffer(
          profile.thumbnailMediaId,
        );
        thumbnailPayload = { buffer, mimeType: thumb.mimeType };
      } else {
        this.logger.warn(
          `Profile ${profile.id}: bỏ qua thumbnail sync — media không hợp lệ`,
        );
      }
    }

    for (const ls of rows) {
      if (!ls.youtubeBroadcastId) {
        continue;
      }
      try {
        await this.youtubeOrchestrator.syncProfileMetadataToActiveBroadcast(
          ls.googleAccountId,
          ls.youtubeBroadcastId,
          {
            title,
            description,
            privacyStatus,
            tags,
            thumbnailBuffer: thumbnailPayload,
          },
          delta,
        );

        if (delta.video || delta.broadcast) {
          ls.title = title;
          ls.description = description;
          ls.privacyStatus = profile.privacyStatus;
          await this.livestreamRepo.save(ls);
        }

        this.logger.log(
          `Đã đồng bộ profile → livestream ${ls.id} (broadcast ${ls.youtubeBroadcastId}) video=${delta.video} broadcast=${delta.broadcast} thumbnail=${delta.thumbnail}`,
        );
      } catch (err) {
        this.logger.error(
          `Đồng bộ profile ${profile.id} → livestream ${ls.id} thất bại: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}
