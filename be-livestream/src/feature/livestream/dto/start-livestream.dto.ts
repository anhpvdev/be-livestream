import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID, ValidateIf } from 'class-validator';

export class StartLivestreamDto {
  @ApiProperty({
    description: 'Google account ID to use for streaming',
    example: 'c14a0bf6-cac2-49cf-893c-6be1e3b23b8d',
  })
  @IsUUID()
  googleAccountId: string;

  @ApiProperty({
    description: 'Livestream profile id chứa background/audio list',
    example: '879d0b12-0a8b-45b5-9a2f-9fedaba18df0',
  })
  @IsUUID()
  profileId: string;

  @ApiPropertyOptional({
    description:
      'UUID VPS encoder main (stream-ENGINE_NODE=primary). Bỏ trống cả hai VPS thì dùng ENCODER_PRIMARY_URL / ENCODER_BACKUP_URL từ env.',
      example: 'c30c7535-25cf-4044-9d80-9b134facb0a8',
  })
  @ValidateIf((o: StartLivestreamDto) => !!o.backupEncoderVpsId)
  @IsUUID()
  @IsOptional()
  primaryEncoderVpsId?: string;

  @ApiPropertyOptional({
    description:
      'UUID VPS encoder backup (ENGINE_NODE=backup). Phải cùng truyền với primary nếu dùng pool VPS.',
      example: '9796e43c-c7f5-4711-9eae-0f57a467a7d4',
  })
  @ValidateIf((o: StartLivestreamDto) => !!o.primaryEncoderVpsId)
  @IsUUID()
  @IsOptional()
  backupEncoderVpsId?: string;
}
