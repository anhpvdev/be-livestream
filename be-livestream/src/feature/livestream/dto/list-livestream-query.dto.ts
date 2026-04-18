import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { LivestreamStatus } from '../entities/livestream.entity';

export class ListLivestreamQueryDto {
  @ApiPropertyOptional({ enum: LivestreamStatus })
  @IsOptional()
  @IsEnum(LivestreamStatus)
  status?: LivestreamStatus;
}
