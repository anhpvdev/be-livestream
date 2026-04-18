import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';

export class RegisterEncoderVpsWebhookDto {
  @ApiProperty({
    example: 'http://203.0.113.10:8080',
    description:
      'URL công khai tới stream-encoder này (BE dùng health/stop). Phải khớp sau chuẩn hóa với bản ghi DB.',
  })
  @IsUrl({ require_tld: false })
  @MaxLength(500)
  baseUrl: string;

  @ApiProperty({
    example: 'encoder-node-2',
    description:
      'Định danh instance encoder (hostname, ENGINE_NODE, v.v.). Không gắn vai trò main/backup của livestream.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  node: string;

  @ApiPropertyOptional({ example: 'encoder-sg-01' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;
}
