import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';

export class UpdateEncoderVpsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(500)
  baseUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class EncoderVpsListItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  baseUrl: string;

  @ApiProperty()
  enabled: boolean;

  @ApiPropertyOptional({ description: 'ENGINE_NODE báo cáo lần cuối' })
  encoderNode: string | null;

  @ApiPropertyOptional({ description: 'Lần cuối encoder gọi webhook đăng ký' })
  lastSeenAt: Date | null;

  @ApiProperty({
    enum: ['live', 'error', 'ok', '0'],
    description:
      'Trạng thái vận hành VPS: live=đang phát, ok=sẵn sàng, error=mất heartbeat, 0=offline/disabled/chưa đăng ký',
  })
  status: 'live' | 'error' | 'ok' | '0';

  @ApiProperty({
    description: 'true nếu VPS không đang gán cho livestream LIVE/TESTING',
  })
  isFree: boolean;

  @ApiPropertyOptional({
    enum: ['primary', 'backup'],
    description: 'Vai trò trên livestream đang chiếm (nếu có)',
  })
  busyAs: 'primary' | 'backup' | null;

  @ApiPropertyOptional({ description: 'Livestream đang dùng VPS này' })
  busyLivestreamId: string | null;
}
