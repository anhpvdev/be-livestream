import { Injectable, Logger } from '@nestjs/common';
import { GoogleAccountService } from '../google-account/google-account.service';
import {
  CreateBroadcastParams,
  CreateStreamResult,
  YouTubeApiService,
} from './youtube-api.service';
import type { ProfileYoutubeSyncDelta } from '../livestream-profile/profile-youtube-sync.types';

type CreateAndBindResult = {
  broadcastId: string;
  stream: CreateStreamResult;
};

@Injectable()
export class YouTubeLivestreamOrchestratorService {
  private readonly logger = new Logger(
    YouTubeLivestreamOrchestratorService.name,
  );

  constructor(
    private readonly googleAccountService: GoogleAccountService,
    private readonly youtubeApiService: YouTubeApiService,
  ) {}

  async createAndBindBroadcast(
    googleAccountId: string,
    params: CreateBroadcastParams,
  ): Promise<CreateAndBindResult> {
    return this.withAuthRetry(googleAccountId, async (auth) => {
      const broadcast = await this.youtubeApiService.createBroadcast(auth, params);
      const stream = await this.youtubeApiService.createStream(auth);
      await this.youtubeApiService.bindBroadcastToStream(
        auth,
        broadcast.broadcastId,
        stream.streamId,
      );

      if (params.tags?.length) {
        await this.youtubeApiService.updateVideoSnippetTags(
          auth,
          broadcast.broadcastId,
          params.tags,
        );
      }

      return {
        broadcastId: broadcast.broadcastId,
        stream,
      };
    });
  }

  async getBroadcastLifecycleStatus(
    googleAccountId: string,
    broadcastId: string,
  ): Promise<string> {
    return this.withAuthRetry(googleAccountId, async (auth) =>
      this.youtubeApiService.getBroadcastStatus(auth, broadcastId),
    );
  }

  async transitionBroadcast(
    googleAccountId: string,
    broadcastId: string,
    status: 'testing' | 'live' | 'complete',
  ): Promise<void> {
    await this.withAuthRetry(googleAccountId, async (auth) => {
      await this.youtubeApiService.transitionBroadcast(auth, broadcastId, status);
    });
  }

  /**
   * Đồng bộ metadata profile lên phiên live (broadcast + video + thumbnail tùy chọn).
   */
  async syncProfileMetadataToActiveBroadcast(
    googleAccountId: string,
    broadcastId: string,
    payload: {
      title: string;
      description: string;
      privacyStatus: 'public' | 'unlisted' | 'private';
      tags: string[];
      thumbnailBuffer?: { buffer: Buffer; mimeType: string };
    },
    delta: ProfileYoutubeSyncDelta,
  ): Promise<void> {
    await this.withAuthRetry(googleAccountId, async (auth) => {
      if (delta.video) {
        await this.youtubeApiService.updateVideoSnippetForLive(auth, broadcastId, {
          title: payload.title,
          description: payload.description,
          tags: payload.tags,
        });
      }
      if (delta.broadcast) {
        await this.youtubeApiService.updateLiveBroadcastDisplayMetadata(
          auth,
          broadcastId,
          {
            title: payload.title,
            description: payload.description,
            privacyStatus: payload.privacyStatus,
          },
        );
      }
      if (delta.thumbnail && payload.thumbnailBuffer) {
        const mime =
          payload.thumbnailBuffer.mimeType === 'image/jpg' ?
            'image/jpeg'
          : payload.thumbnailBuffer.mimeType;
        await this.youtubeApiService.setThumbnail(
          auth,
          broadcastId,
          payload.thumbnailBuffer.buffer,
          mime,
        );
      }
    });
  }

  async setBroadcastThumbnail(
    googleAccountId: string,
    broadcastId: string,
    imageBuffer: Buffer,
    mimeType: string,
  ): Promise<void> {
    const supportedMimeTypes = ['image/png', 'image/jpeg', 'image/jpg'];
    if (!supportedMimeTypes.includes(mimeType)) {
      throw new Error(`Unsupported thumbnail mime type: ${mimeType}`);
    }
    const youtubeMimeType = mimeType === 'image/jpg' ? 'image/jpeg' : mimeType;
    await this.withAuthRetry(googleAccountId, async (auth) => {
      await this.youtubeApiService.setThumbnail(
        auth,
        broadcastId,
        imageBuffer,
        youtubeMimeType,
      );
    });
  }

  async waitForStreamReady(
    googleAccountId: string,
    streamId: string,
    maxAttempts = 30,
  ): Promise<void> {
    await this.withAuthRetry(googleAccountId, async (auth) => {
      for (let i = 0; i < maxAttempts; i++) {
        const status = await this.youtubeApiService.getStreamStatus(auth, streamId);
        if (status === 'active') return;
        await this.delay(2000);
      }
      throw new Error(`Stream ${streamId} did not become active within timeout`);
    });
  }

  private async getAuthenticatedClient(
    googleAccountId: string,
    forceRefresh = false,
  ) {
    const account = await this.googleAccountService.findById(googleAccountId);
    return await this.googleAccountService.getAuthenticatedClient(
      account,
      forceRefresh,
    );
  }

  private async withAuthRetry<T>(
    googleAccountId: string,
    execute: (auth: Awaited<ReturnType<typeof this.getAuthenticatedClient>>) => Promise<T>,
  ): Promise<T> {
    try {
      const auth = await this.getAuthenticatedClient(googleAccountId);
      return await execute(auth);
    } catch (error) {
      if (!this.isInvalidTokenError(error)) {
        throw error;
      }

      this.logger.warn(
        `YouTube API invalid token for ${googleAccountId}, forcing token refresh and retrying once`,
      );
      const refreshedAuth = await this.getAuthenticatedClient(googleAccountId, true);
      return await execute(refreshedAuth);
    }
  }

  private isInvalidTokenError(error: unknown): boolean {
    const maybeError = error as { status?: number; code?: number; response?: { status?: number } };
    return (
      maybeError?.status === 401 ||
      maybeError?.code === 401 ||
      maybeError?.response?.status === 401
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
