import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { MediaFileKind, MediaFileStatus } from '../entities/media.entity';

export class ListMediaQueryDto {
  @ApiPropertyOptional({ enum: MediaFileStatus })
  @IsOptional()
  @IsEnum(MediaFileStatus)
  status?: MediaFileStatus;

  @ApiPropertyOptional({ enum: MediaFileKind })
  @IsOptional()
  @IsEnum(MediaFileKind)
  type?: MediaFileKind;
}
