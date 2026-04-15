import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { PrivacyStatus } from '../entities/livestream.entity';

export class StartLivestreamDto {
  @ApiProperty({
    description: 'Google account ID to use for streaming',
    example: '33ca0fe4-b615-4128-a89a-65a47aefd81f',
  })
  @IsUUID()
  googleAccountId: string;

  @ApiProperty({
    description: 'Livestream profile id chứa background/audio list',
    example: 'a9d4d98e-d514-4a2d-96e4-9ec3112acb4e',
  })
  @IsUUID()
  profileId: string;

  @ApiProperty({ 
    description: 'Livestream title on YouTube', 
    example: 'Morning coffe livestream'
  })
  @IsString()
  title: string;

  @ApiPropertyOptional({ 
    description: 'Livestream description', 
    example: 'Morning coffe livestream'
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    enum: PrivacyStatus,
    default: PrivacyStatus.UNLISTED,
    example: PrivacyStatus.UNLISTED,
  })
  @IsOptional()
  @IsEnum(PrivacyStatus)
  privacyStatus?: PrivacyStatus;
}
