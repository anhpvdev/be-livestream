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

  @ApiPropertyOptional({ description: 'Phần trăm RAM sử dụng (vd: 62.45%)' })
  ram_percent?: string;

  @ApiPropertyOptional({ description: 'Phần trăm CPU sử dụng (ước lượng theo loadavg 1m)' })
  cpu_percent?: string;

  @ApiPropertyOptional({ description: 'Phần trăm GPU sử dụng (nếu có probe GPU)' })
  gpu_percent?: string | null;
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

  @ApiPropertyOptional({ description: 'Bitrate tính theo Mbps (vd: 4.12 Mbps)' })
  bitrate_mbps?: string;

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
