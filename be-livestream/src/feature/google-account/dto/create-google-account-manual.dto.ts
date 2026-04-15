import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateGoogleAccountManualDto {
  @ApiProperty({ example: 'studio-youtube-1' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  accountName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  channelName?: string;

  @ApiProperty({ description: 'OAuth client id' })
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  clientId: string;

  @ApiPropertyOptional({
    description: 'OAuth client secret (cần để refresh token)',
  })
  @IsOptional()
  @IsString()
  clientSecret?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  refreshToken?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  channelId?: string;
}
