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

  @ApiProperty({ enum: LivestreamStatus })
  status: LivestreamStatus;

  @ApiProperty({ enum: PrivacyStatus })
  privacyStatus: PrivacyStatus;

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

export class LivestreamEncoderHealthDto {
  @ApiPropertyOptional({ nullable: true })
  node: string | null;

  @ApiPropertyOptional({ nullable: true })
  status: string | null;

  @ApiPropertyOptional({ nullable: true })
  livestreamId: string | null;

  @ApiPropertyOptional({ nullable: true })
  timestampStr: string | null;

  @ApiPropertyOptional({ nullable: true })
  bitrate: string | null;

  @ApiPropertyOptional({ nullable: true })
  pid: number | null;
}

export class LivestreamEncoderNodeStatusDto {
  @ApiPropertyOptional({ nullable: true })
  encoderVpsId: string | null;

  @ApiPropertyOptional({ nullable: true })
  vpsName: string | null;

  @ApiPropertyOptional({ nullable: true })
  resolvedBaseUrl: string | null;

  @ApiPropertyOptional({ nullable: true, type: LivestreamEncoderHealthDto })
  health: LivestreamEncoderHealthDto | null;

  @ApiProperty()
  isPlaylistAuthority: boolean;
}

export class LivestreamEncoderNodesDto {
  @ApiProperty({ type: LivestreamEncoderNodeStatusDto })
  primary: LivestreamEncoderNodeStatusDto;

  @ApiProperty({ type: LivestreamEncoderNodeStatusDto })
  backup: LivestreamEncoderNodeStatusDto;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'owner_node/active_node trong encoder_jobs khi khớp encoder_node của primary hoặc backup đang cấu hình; null nếu không khớp (dữ liệu cũ / encoder khác cùng DB)',
  })
  playlistAuthorityNode: string | null;
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

  @ApiPropertyOptional({ description: 'YouTube broadcast lifecycle status' })
  youtubeBroadcastStatus: string;

  @ApiProperty({
    type: LivestreamEncoderNodesDto,
    description: 'Thông số VPS + health hiện tại của encoder primary/backup',
  })
  encoderNodes: LivestreamEncoderNodesDto;
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
