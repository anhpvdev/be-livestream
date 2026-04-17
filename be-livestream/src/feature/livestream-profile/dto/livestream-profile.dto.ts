import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsEnum,
  IsArray,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  ValidateIf,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PrivacyStatus } from '../../livestream/entities/livestream.entity';

export class CreateLivestreamProfileDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    type: [String],
    description: 'Danh sách video id để loop stream',
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  videoMediaIds: string[];

  @ApiPropertyOptional({
    description: 'Tiêu đề livestream dùng khi start từ profile',
    example: 'Morning coffee livestream',
  })
  @IsOptional()
  @IsString()
  livestreamTitle?: string;

  @ApiPropertyOptional({
    description: 'Mô tả livestream dùng khi start từ profile',
    example: 'Auto run from profile settings',
  })
  @IsOptional()
  @IsString()
  livestreamDescription?: string;

  @ApiPropertyOptional({
    description: 'Thumbnail URL để set cho broadcast khi start',
    example: 'https://cdn.example.com/live-thumb.jpg',
  })
  @IsOptional()
  @IsUrl({ require_tld: true })
  thumbnailUrl?: string;

  @ApiPropertyOptional({
    enum: PrivacyStatus,
    default: PrivacyStatus.UNLISTED,
  })
  @IsOptional()
  @IsEnum(PrivacyStatus)
  privacyStatus?: PrivacyStatus;

  @ApiPropertyOptional({
    description:
      'YouTube broadcast ID có sẵn. Nếu có thì start sẽ bind vào stream có sẵn thay vì auto create.',
    example: 'a1B2c3D4e5F',
  })
  @IsOptional()
  @IsString()
  youtubeBroadcastId?: string;

  @ApiPropertyOptional({
    description: 'YouTube stream ID có sẵn, bắt buộc khi có youtubeBroadcastId',
  })
  @ValidateIf((dto: CreateLivestreamProfileDto) => !!dto.youtubeBroadcastId)
  @IsString()
  youtubeStreamId?: string;

  @ApiPropertyOptional({
    description:
      'YouTube stream key có sẵn, bắt buộc khi có youtubeBroadcastId',
  })
  @ValidateIf((dto: CreateLivestreamProfileDto) => !!dto.youtubeBroadcastId)
  @IsString()
  youtubeStreamKey?: string;

  @ApiPropertyOptional({
    description: 'RTMP ingest URL, optional nếu đã có streamId',
  })
  @IsOptional()
  @IsString()
  youtubeRtmpUrl?: string;

  @ApiPropertyOptional({
    description: 'Backup RTMP ingest URL',
  })
  @IsOptional()
  @IsString()
  youtubeBackupRtmpUrl?: string;
}

export class AddProfileVideoDto {
  @ApiProperty()
  @IsUUID()
  mediaId: string;
}

export class ReorderProfileVideosDto {
  @ApiProperty({
    type: [String],
    description: 'Danh sách mediaId theo thứ tự mới',
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  mediaIds: string[];
}

export class UpdateLivestreamProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Tiêu đề livestream dùng khi start từ profile',
  })
  @IsOptional()
  @IsString()
  livestreamTitle?: string;

  @ApiPropertyOptional({
    description: 'Mô tả livestream dùng khi start từ profile',
  })
  @IsOptional()
  @IsString()
  livestreamDescription?: string;

  @ApiPropertyOptional({
    description: 'Thumbnail URL để set cho broadcast khi start',
  })
  @IsOptional()
  @IsUrl({ require_tld: true })
  thumbnailUrl?: string;

  @ApiPropertyOptional({ enum: PrivacyStatus })
  @IsOptional()
  @IsEnum(PrivacyStatus)
  privacyStatus?: PrivacyStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  youtubeBroadcastId?: string;

  @ApiPropertyOptional()
  @ValidateIf((dto: UpdateLivestreamProfileDto) => !!dto.youtubeBroadcastId)
  @IsString()
  youtubeStreamId?: string;

  @ApiPropertyOptional()
  @ValidateIf((dto: UpdateLivestreamProfileDto) => !!dto.youtubeBroadcastId)
  @IsString()
  youtubeStreamKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  youtubeRtmpUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  youtubeBackupRtmpUrl?: string;
}
