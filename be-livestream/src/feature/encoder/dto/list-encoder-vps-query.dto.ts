import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';

export enum EncoderVpsStatusEnum {
  LIVE = 'live',
  ERROR = 'error',
  OK = 'ok',
  OFFLINE = '0',
}
export type EncoderVpsStatus = `${EncoderVpsStatusEnum}`;

export class ListEncoderVpsQueryDto {
  @ApiPropertyOptional({ enum: EncoderVpsStatusEnum })
  @IsOptional()
  @IsEnum(EncoderVpsStatusEnum)
  status?: EncoderVpsStatus;

  @ApiPropertyOptional({ description: 'Lọc VPS enabled=true/false' })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ description: 'Lọc VPS free=true/false' })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  isFree?: boolean;
}
