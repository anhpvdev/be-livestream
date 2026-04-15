import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GoogleAccountStatus } from '../entities/google-account.entity';

export class GoogleAccountResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ description: 'Nhãn nội bộ để phân biệt credential' })
  accountLabel: string;

  @ApiPropertyOptional({ nullable: true })
  email: string | null;

  @ApiPropertyOptional({ nullable: true })
  displayName: string | null;

  @ApiProperty({ description: 'OAuth client id (public identifier)' })
  clientId: string;

  @ApiProperty({ description: 'Đã lưu client secret (mã hoá) trong DB' })
  hasClientSecret: boolean;

  @ApiProperty({ description: 'Đã lưu refresh token (mã hoá) trong DB' })
  hasRefreshToken: boolean;

  @ApiPropertyOptional({ nullable: true })
  channelId: string | null;

  @ApiProperty({ enum: GoogleAccountStatus })
  status: GoogleAccountStatus;

  @ApiProperty()
  tokenExpiresAt: Date;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
