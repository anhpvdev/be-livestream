import { ApiProperty } from '@nestjs/swagger';
import { MediaFileKind, MediaFileStatus } from '../entities/media.entity';

export class MediaResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  originalName: string;

  @ApiProperty()
  storageKey: string;

  @ApiProperty()
  mimeType: string;

  @ApiProperty({
    enum: MediaFileKind,
    description: 'Loại media để encoder xử lý',
  })
  type: MediaFileKind;

  @ApiProperty()
  sizeBytes: number;

  @ApiProperty({ nullable: true })
  durationSeconds: number;

  @ApiProperty({ nullable: true })
  resolution: string;

  @ApiProperty({ nullable: true })
  codec: string;

  @ApiProperty({ enum: MediaFileStatus })
  status: MediaFileStatus;

  @ApiProperty()
  createdAt: Date;
}
