import { Injectable, Logger } from '@nestjs/common';
import { google, youtube_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { Readable } from 'stream';

export interface CreateBroadcastParams {
  title: string;
  description?: string;
  scheduledStartTime: Date;
  privacyStatus: 'public' | 'unlisted' | 'private';
}

export interface CreateStreamResult {
  streamId: string;
  streamKey: string;
  rtmpUrl: string;
  backupRtmpUrl: string | null;
}

export interface BroadcastResult {
  broadcastId: string;
  lifeCycleStatus: string;
}

const YOUTUBE_RTMP_PRIMARY_URL = 'rtmp://a.rtmp.youtube.com/live2';
const YOUTUBE_RTMP_BACKUP_URL = 'rtmp://b.rtmp.youtube.com/live2?backup=1';

@Injectable()
export class YouTubeApiService {
  private readonly logger = new Logger(YouTubeApiService.name);

  private getClient(auth: OAuth2Client): youtube_v3.Youtube {
    return google.youtube({ version: 'v3', auth });
  }

  async createBroadcast(
    auth: OAuth2Client,
    params: CreateBroadcastParams,
  ): Promise<BroadcastResult> {
    const youtube = this.getClient(auth);

    const { data } = await youtube.liveBroadcasts.insert({
      part: ['snippet', 'status', 'contentDetails'],
      requestBody: {
        snippet: {
          title: params.title,
          description: params.description || '',
          scheduledStartTime: params.scheduledStartTime.toISOString(),
        },
        status: {
          privacyStatus: params.privacyStatus,
          selfDeclaredMadeForKids: false,
        },
        contentDetails: {
          enableAutoStart: false,
          enableAutoStop: true,
          monitorStream: { enableMonitorStream: false },
        },
      },
    });

    this.logger.log(`Broadcast created: ${data.id}`);
    return {
      broadcastId: data.id,
      lifeCycleStatus: data.status?.lifeCycleStatus,
    };
  }

  async createStream(auth: OAuth2Client): Promise<CreateStreamResult> {
    const youtube = this.getClient(auth);

    const { data } = await youtube.liveStreams.insert({
      part: ['snippet', 'cdn'],
      requestBody: {
        snippet: {
          title: `Stream-${Date.now()}`,
        },
        cdn: {
          frameRate: '30fps',
          resolution: '1080p',
          ingestionType: 'rtmp',
        },
      },
    });

    const ingestionInfo = data.cdn?.ingestionInfo;
    this.logger.log(`Stream created: ${data.id}`);

    return {
      streamId: data.id,
      streamKey: ingestionInfo?.streamName || '',
      rtmpUrl: YOUTUBE_RTMP_PRIMARY_URL,
      backupRtmpUrl: YOUTUBE_RTMP_BACKUP_URL,
    };
  }

  async bindBroadcastToStream(
    auth: OAuth2Client,
    broadcastId: string,
    streamId: string,
  ): Promise<void> {
    const youtube = this.getClient(auth);

    await youtube.liveBroadcasts.bind({
      id: broadcastId,
      part: ['id', 'contentDetails'],
      streamId,
    });

    this.logger.log(`Broadcast ${broadcastId} bound to stream ${streamId}`);
  }

  async transitionBroadcast(
    auth: OAuth2Client,
    broadcastId: string,
    status: 'testing' | 'live' | 'complete',
  ): Promise<void> {
    const youtube = this.getClient(auth);

    await youtube.liveBroadcasts.transition({
      broadcastStatus: status,
      id: broadcastId,
      part: ['id', 'status'],
    });

    this.logger.log(`Broadcast ${broadcastId} transitioned to ${status}`);
  }

  async getStreamStatus(auth: OAuth2Client, streamId: string): Promise<string> {
    const youtube = this.getClient(auth);

    const { data } = await youtube.liveStreams.list({
      id: [streamId],
      part: ['status'],
    });

    return data.items?.[0]?.status?.streamStatus || 'unknown';
  }

  async getBroadcastStatus(
    auth: OAuth2Client,
    broadcastId: string,
  ): Promise<string> {
    const youtube = this.getClient(auth);

    const { data } = await youtube.liveBroadcasts.list({
      id: [broadcastId],
      part: ['status'],
    });

    return data.items?.[0]?.status?.lifeCycleStatus || 'unknown';
  }

  async setThumbnail(
    auth: OAuth2Client,
    videoId: string,
    imageBuffer: Buffer,
    mimeType: string,
  ): Promise<void> {
    const youtube = this.getClient(auth);
    await youtube.thumbnails.set({
      videoId,
      media: {
        mimeType,
        body: Readable.from(imageBuffer),
      },
    });
    this.logger.log(`Thumbnail updated for video ${videoId}`);
  }
}
