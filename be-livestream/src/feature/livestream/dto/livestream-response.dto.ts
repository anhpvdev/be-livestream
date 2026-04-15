import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LivestreamStatus, PrivacyStatus } from '../entities/livestream.entity';

export class LivestreamResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  googleAccountId: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Media hiện đang được phát',
  })
  currentMediaId: string | null;

  @ApiPropertyOptional({ nullable: true })
  profileId: string | null;

  @ApiPropertyOptional({ nullable: true })
  currentSegmentId: string | null;

  @ApiProperty()
  title: string;

  @ApiPropertyOptional()
  description: string;

  @ApiPropertyOptional()
  youtubeBroadcastId: string;

  @ApiPropertyOptional()
  youtubeStreamId: string;

  @ApiPropertyOptional({ description: 'RTMP URL hiện tại dùng để đẩy stream' })
  streamUrl: string;

  @ApiPropertyOptional()
  youtubeBackupRtmpUrl: string;

  @ApiProperty({ enum: LivestreamStatus })
  status: LivestreamStatus;

  @ApiProperty({ enum: PrivacyStatus })
  privacyStatus: PrivacyStatus;

  @ApiPropertyOptional()
  actualStartTime: Date;

  @ApiPropertyOptional()
  actualEndTime: Date;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class LivestreamProgressSnapshotDto {
  @ApiProperty()
  currentTimestampMs: number;

  @ApiProperty()
  currentTimestampStr: string;

  @ApiPropertyOptional({ nullable: true })
  framesProcessed: number | null;

  @ApiPropertyOptional({ nullable: true })
  bytesProcessed: number | null;

  @ApiPropertyOptional({ nullable: true })
  currentBitrate: string | null;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty()
  encoderSessionId: string;
}

export class LivestreamStatusResponseDto extends LivestreamResponseDto {
  @ApiPropertyOptional({
    nullable: true,
    description:
      'Trên endpoint status: currentMediaId được align với encoder_jobs.current_media_id khi có job; các endpoint khác vẫn là mediaFileId ban đầu của livestream.',
  })
  currentMediaId: string | null;

  @ApiPropertyOptional({
    type: LivestreamProgressSnapshotDto,
    nullable: true,
    description: 'Snapshot progress theo encoder session đang active',
  })
  progress: LivestreamProgressSnapshotDto | null;

  @ApiPropertyOptional({ description: 'Current encode timestamp in ms' })
  currentTimestampMs: number;

  @ApiPropertyOptional({ description: 'Current encode timestamp string' })
  currentTimestampStr: string;

  @ApiPropertyOptional({ description: 'Encoder node in use' })
  encoderNode: string;

  @ApiPropertyOptional({ description: 'YouTube broadcast lifecycle status' })
  youtubeBroadcastStatus: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Node encoder đang báo active trong encoder_jobs',
  })
  encoderJobActiveNode: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'current_media_id trong encoder_jobs (media encoder đang phát)',
  })
  encoderCurrentMediaId: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'current_video_index trong encoder_jobs',
  })
  encoderCurrentVideoIndex: number | null;
}

export class StartLivestreamAckDto {
  @ApiProperty()
  message: string;

  @ApiProperty({ description: 'ID bản ghi livestream trong hệ thống' })
  livestreamId: string;

  @ApiProperty({ description: 'YouTube stream id' })
  youtubeStreamId: string;

  @ApiProperty({ description: 'YouTube broadcast id' })
  youtubeBroadcastId: string;

  @ApiPropertyOptional({ description: 'Link xem stream nếu có' })
  watchUrl: string | null;

  @ApiProperty({ enum: LivestreamStatus })
  status: LivestreamStatus;
}
