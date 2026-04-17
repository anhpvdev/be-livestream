import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

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
}
