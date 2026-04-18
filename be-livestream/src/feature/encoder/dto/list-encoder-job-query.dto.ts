import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { EncoderDesiredState } from '../entities/encoder-job.entity';

export class ListEncoderJobQueryDto {
  @ApiPropertyOptional({ enum: EncoderDesiredState })
  @IsOptional()
  @IsEnum(EncoderDesiredState)
  desiredState?: EncoderDesiredState;
}
