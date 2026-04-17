import { Injectable, Logger } from '@nestjs/common';
import { GoogleAccountService } from '../google-account/google-account.service';
import {
  CreateBroadcastParams,
  CreateStreamResult,
  StreamIngestionInfo,
  YouTubeApiService,
} from './youtube-api.service';

type CreateAndBindResult = {
  broadcastId: string;
  stream: CreateStreamResult;
};

type BindExistingResult = {
  broadcastId: string;
  stream: StreamIngestionInfo;
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
    const auth = await this.getAuthenticatedClient(googleAccountId);
    const broadcast = await this.youtubeApiService.createBroadcast(
      auth,
      params,
    );
    const stream = await this.youtubeApiService.createStream(auth);
    await this.youtubeApiService.bindBroadcastToStream(
      auth,
      broadcast.broadcastId,
      stream.streamId,
    );

    return {
      broadcastId: broadcast.broadcastId,
      stream,
    };
  }

  async bindExistingBroadcast(
    googleAccountId: string,
    broadcastId: string,
    streamId: string,
  ): Promise<BindExistingResult> {
    const auth = await this.getAuthenticatedClient(googleAccountId);
    await this.youtubeApiService.bindBroadcastToStream(auth, broadcastId, streamId);
    const stream = await this.youtubeApiService.getStreamIngestionInfo(
      auth,
      streamId,
    );

    return {
      broadcastId,
      stream,
    };
  }

  async getBroadcastLifecycleStatus(
    googleAccountId: string,
    broadcastId: string,
  ): Promise<string> {
    const auth = await this.getAuthenticatedClient(googleAccountId);
    return this.youtubeApiService.getBroadcastStatus(auth, broadcastId);
  }

  async transitionBroadcast(
    googleAccountId: string,
    broadcastId: string,
    status: 'testing' | 'live' | 'complete',
  ): Promise<void> {
    const auth = await this.getAuthenticatedClient(googleAccountId);
    await this.youtubeApiService.transitionBroadcast(auth, broadcastId, status);
  }

  async setBroadcastThumbnailFromUrl(
    googleAccountId: string,
    broadcastId: string,
    thumbnailUrl: string,
  ): Promise<void> {
    const auth = await this.getAuthenticatedClient(googleAccountId);
    const response = await fetch(thumbnailUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch thumbnail from URL: ${thumbnailUrl}`);
    }

    const contentType = response.headers.get('content-type') || '';
    const isPng = contentType.includes('image/png');
    const isJpeg =
      contentType.includes('image/jpeg') || contentType.includes('image/jpg');
    if (!isPng && !isJpeg) {
      throw new Error(
        `Unsupported thumbnail mime type: ${contentType || 'unknown'}`,
      );
    }
    const mimeType = isPng ? 'image/png' : 'image/jpeg';
    const buffer = Buffer.from(await response.arrayBuffer());
    await this.youtubeApiService.setThumbnail(auth, broadcastId, buffer, mimeType);
  }

  async waitForStreamReady(
    googleAccountId: string,
    streamId: string,
    maxAttempts = 30,
  ): Promise<void> {
    const auth = await this.getAuthenticatedClient(googleAccountId);
    for (let i = 0; i < maxAttempts; i++) {
      const status = await this.youtubeApiService.getStreamStatus(
        auth,
        streamId,
      );
      if (status === 'active') return;
      await this.delay(2000);
    }
    this.logger.warn(`Stream ${streamId} did not become active within timeout`);
  }

  private async getAuthenticatedClient(googleAccountId: string) {
    const account = await this.googleAccountService.findById(googleAccountId);
    return this.googleAccountService.getAuthenticatedClient(account);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
