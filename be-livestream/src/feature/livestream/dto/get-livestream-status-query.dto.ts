import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

export class GetLivestreamStatusQueryDto {
  @ApiPropertyOptional({
    description: 'Populate thông tin profile theo profileId của livestream',
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  populate_profile?: boolean;

  @ApiPropertyOptional({
    description:
      'Populate đầy đủ từng media trong profile (video playlist + thumbnail). Khi true thì populate_profile được coi như true.',
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  populate_media?: boolean;
}
