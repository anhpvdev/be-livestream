import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  EncoderNode,
  EncoderSessionStatus,
} from '../entities/encoder-session.entity';

export class EncoderHostMetricsDto {
  @ApiPropertyOptional({
    description: 'Load average (1/5/15 phút) từ VPS encoder, nếu stream-encoder báo cáo',
  })
  loadavg?: number[];

  @ApiPropertyOptional({ description: 'RAM host còn trống (bytes)' })
  freemem?: number;

  @ApiPropertyOptional({ description: 'RAM host tổng (bytes)' })
  totalmem?: number;

  @ApiPropertyOptional({ description: 'RSS process encoder (MB)' })
  process_rss_mb?: number;

  @ApiPropertyOptional({
    description: 'GPU: chưa có probe tự động thì null',
    nullable: true,
  })
  gpu?: null | Record<string, unknown>;
}

export class EncoderHealthResponse {
  @ApiProperty()
  node: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  timestamp_ms: number;

  @ApiProperty()
  timestamp_str: string;

  @ApiProperty()
  frames: number;

  @ApiPropertyOptional()
  bitrate: string;

  @ApiPropertyOptional()
  speed: string;

  @ApiPropertyOptional()
  pid: number;

  @ApiPropertyOptional()
  livestreamId?: string | null;

  @ApiPropertyOptional({ type: EncoderHostMetricsDto })
  host?: EncoderHostMetricsDto;
}

export class EncoderSessionResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  livestreamId: string;

  @ApiProperty({ enum: EncoderNode })
  encoderNode: EncoderNode;

  @ApiProperty({ enum: EncoderSessionStatus })
  status: EncoderSessionStatus;

  @ApiPropertyOptional()
  ffmpegPid: number;

  @ApiPropertyOptional()
  startedAt: Date;

  @ApiPropertyOptional()
  stoppedAt: Date;

  @ApiPropertyOptional()
  crashReason: string;

  @ApiProperty()
  createdAt: Date;
}
