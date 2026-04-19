import { Injectable, Logger } from '@nestjs/common';
import { google, youtube_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { Readable } from 'stream';
import { clipTagsForYoutubeApi } from './youtube-tags.util';

export interface CreateBroadcastParams {
  title: string;
  description?: string;
  scheduledStartTime: Date;
  privacyStatus: 'public' | 'unlisted' | 'private';
  /** Tags áp dụng qua videos.update (broadcast id = video id); không có trên liveBroadcasts.insert */
  tags?: string[];
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

  /**
   * Gán tags cho live broadcast: resource là `videos`, id trùng broadcast id.
   * Bắt buộc gửi kèm title + categoryId (lấy từ videos.list).
   */
  async updateVideoSnippetTags(
    auth: OAuth2Client,
    videoId: string,
    tags: string[],
  ): Promise<void> {
    const clipped = clipTagsForYoutubeApi(tags);
    if (!clipped.length) return;

    const youtube = this.getClient(auth);
    const { data: listData } = await youtube.videos.list({
      id: [videoId],
      part: ['snippet'],
    });
    const sn = listData.items?.[0]?.snippet;
    if (!sn?.categoryId) {
      this.logger.warn(
        `Không set tags: thiếu categoryId sau videos.list cho ${videoId}`,
      );
      return;
    }

    await youtube.videos.update({
      part: ['snippet'],
      requestBody: {
        id: videoId,
        snippet: {
          title: sn.title ?? '',
          description: sn.description ?? '',
          categoryId: sn.categoryId,
          tags: clipped,
        },
      },
    });
    this.logger.log(`Đã cập nhật tags cho video/broadcast ${videoId}`);
  }

  /**
   * Cập nhật title/description/tags trên resource `videos` (id = broadcast id) khi đang live.
   */
  async updateVideoSnippetForLive(
    auth: OAuth2Client,
    videoId: string,
    params: { title: string; description: string; tags: string[] },
  ): Promise<void> {
    const youtube = this.getClient(auth);
    const { data: listData } = await youtube.videos.list({
      id: [videoId],
      part: ['snippet'],
    });
    const item0 = listData.items?.[0];
    const sn = item0?.snippet;
    if (!item0) {
      this.logger.warn(
        `updateVideoSnippetForLive: videos.list không trả video id=${videoId} — bỏ qua (kiểm tra OAuth / id trùng broadcast)`,
      );
      return;
    }
    if (!sn?.categoryId) {
      this.logger.warn(
        `updateVideoSnippetForLive: thiếu categoryId sau videos.list cho ${videoId}`,
      );
      return;
    }
    const clipped = clipTagsForYoutubeApi(params.tags);
    await youtube.videos.update({
      part: ['snippet'],
      requestBody: {
        id: videoId,
        snippet: {
          title: params.title,
          description: params.description ?? '',
          categoryId: sn.categoryId,
          tags: clipped,
        },
      },
    });
    this.logger.log(
      `Đã cập nhật snippet video (live) ${videoId} titleLen=${params.title.length} tags=${clipped.length}`,
    );
  }

  /**
   * Cập nhật title/description/privacy trên liveBroadcast (giao diện sự kiện live).
   */
  async updateLiveBroadcastDisplayMetadata(
    auth: OAuth2Client,
    broadcastId: string,
    params: {
      title: string;
      description: string;
      privacyStatus: 'public' | 'unlisted' | 'private';
    },
  ): Promise<void> {
    const youtube = this.getClient(auth);
    const { data: listData } = await youtube.liveBroadcasts.list({
      id: [broadcastId],
      part: ['snippet', 'status', 'contentDetails'],
    });
    const item = listData.items?.[0];
    const snippet = item?.snippet;
    const st = item?.status;
    if (!snippet || !st) {
      this.logger.warn(
        `updateLiveBroadcastDisplayMetadata: không đọc được broadcast ${broadcastId}`,
      );
      return;
    }

    // Chỉ gửi field được phép sửa; không spread status (lifeCycleStatus/recordingStatus là read-only → dễ khiến client/API bỏ qua cập nhật).
    await youtube.liveBroadcasts.update({
      part: ['snippet', 'status'],
      requestBody: {
        id: broadcastId,
        snippet: {
          channelId: snippet.channelId ?? undefined,
          title: params.title,
          description: params.description ?? '',
          scheduledStartTime: snippet.scheduledStartTime ?? undefined,
        },
        status: {
          privacyStatus: params.privacyStatus,
          selfDeclaredMadeForKids: st.selfDeclaredMadeForKids ?? false,
        },
      },
    });
    this.logger.log(
      `Đã cập nhật liveBroadcast snippet/status ${broadcastId} titleLen=${params.title.length}`,
    );
  }
}
