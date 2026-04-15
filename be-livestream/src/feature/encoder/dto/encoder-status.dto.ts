import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  EncoderNode,
  EncoderSessionStatus,
} from '../entities/encoder-session.entity';

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
