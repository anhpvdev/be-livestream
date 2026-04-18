import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

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
}
