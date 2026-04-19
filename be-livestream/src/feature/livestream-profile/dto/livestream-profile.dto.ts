import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsEnum,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
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
    description:
      'Tags cho video/broadcast trên YouTube, cách nhau bằng dấu phẩy (sau khi start sẽ gửi qua API videos.update)',
    example: 'gaming, live, music',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  livestreamTags?: string;

  @ApiPropertyOptional({
    description: 'Media ID ảnh thumbnail để set cho broadcast khi start',
  })
  @IsOptional()
  @IsUUID()
  thumbnailMediaId?: string;

  @ApiPropertyOptional({
    enum: PrivacyStatus,
    default: PrivacyStatus.UNLISTED,
  })
  @IsOptional()
  @IsEnum(PrivacyStatus)
  privacyStatus?: PrivacyStatus;
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
    description:
      'Tags YouTube, cách nhau bằng dấu phẩy (áp dụng khi start qua videos.update)',
    example: 'gaming, live',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  livestreamTags?: string;

  @ApiPropertyOptional({
    description: 'Media ID ảnh thumbnail để set cho broadcast khi start',
  })
  @IsOptional()
  @IsUUID()
  thumbnailMediaId?: string;

  @ApiPropertyOptional({ enum: PrivacyStatus })
  @IsOptional()
  @IsEnum(PrivacyStatus)
  privacyStatus?: PrivacyStatus;
}
