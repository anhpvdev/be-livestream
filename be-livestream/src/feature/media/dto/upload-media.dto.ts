import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { MediaFileKind } from '../entities/media.entity';

export class UploadMediaDto {
  @ApiProperty({ description: 'Tên hiển thị do user tự đặt để sort/filter' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @ApiProperty({
    enum: MediaFileKind,
    description: 'Loại media: video/audio/image',
  })
  @IsEnum(MediaFileKind)
  type: MediaFileKind;

  @ApiProperty({ type: 'string', format: 'binary', description: 'Video file' })
  file: Express.Multer.File;
}
