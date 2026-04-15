import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateLivestreamProfileDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    type: [String],
    description: 'Danh sách video id để loop stream',
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  videoMediaIds: string[];
}

export class AddProfileVideoDto {
  @ApiProperty()
  @IsUUID()
  mediaId: string;
}

export class ReorderProfileVideosDto {
  @ApiProperty({
    type: [String],
    description: 'Danh sách mediaId theo thứ tự mới',
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  mediaIds: string[];
}
