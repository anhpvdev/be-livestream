import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { GoogleAccountService } from './google-account.service';
import { GoogleAccountResponseDto } from './dto/google-account-response.dto';
import { CreateGoogleAccountManualDto } from './dto/create-google-account-manual.dto';
import { UpdateGoogleAccountManualDto } from './dto/update-google-account-manual.dto';

@ApiTags('Google Accounts')
@Controller('accounts')
export class GoogleAccountController {
  constructor(private readonly googleAccountService: GoogleAccountService) {}

  @Post()
  @ApiOperation({
    summary: 'Tạo credential Google (token + client id) thủ công',
  })
  @ApiBody({ type: CreateGoogleAccountManualDto })
  @ApiOkResponse({ type: GoogleAccountResponseDto })
  async createManual(
    @Body() dto: CreateGoogleAccountManualDto,
  ): Promise<GoogleAccountResponseDto> {
    const acc = await this.googleAccountService.createManual(dto);
    return this.toResponse(acc);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Cập nhật credential Google thủ công' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiBody({ type: UpdateGoogleAccountManualDto })
  @ApiOkResponse({ type: GoogleAccountResponseDto })
  async updateManual(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGoogleAccountManualDto,
  ): Promise<GoogleAccountResponseDto> {
    const acc = await this.googleAccountService.updateManual(id, dto);
    return this.toResponse(acc);
  }

  @Get()
  @ApiOperation({ summary: 'List all Google accounts' })
  @ApiOkResponse({ type: [GoogleAccountResponseDto] })
  async findAll(): Promise<GoogleAccountResponseDto[]> {
    const accounts = await this.googleAccountService.findAll();
    return accounts.map((acc) => this.toResponse(acc));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get Google account by ID' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiOkResponse({ type: GoogleAccountResponseDto })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<GoogleAccountResponseDto> {
    const acc = await this.googleAccountService.findById(id);
    return this.toResponse(acc);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove Google account (thử revoke refresh token nếu có)',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.googleAccountService.remove(id);
  }

  @Post(':id/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Kiểm tra credential có gọi được YouTube API hay không',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async verify(@Param('id', ParseUUIDPipe) id: string): Promise<{
    ok: boolean;
    accountId: string;
    accountLabel: string;
    channelId: string | null;
    channelTitle: string | null;
    tokenExpiresAt: Date;
    checkedAt: string;
    error?: string;
  }> {
    return this.googleAccountService.verifyAccount(id);
  }

  private toResponse(acc: {
    id: string;
    accountLabel: string;
    email: string | null;
    displayName: string | null;
    clientId: string;
    clientSecret: string | null;
    refreshToken: string | null;
    channelId: string | null;
    status: string;
    tokenExpiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
  }): GoogleAccountResponseDto {
    return {
      id: acc.id,
      accountLabel: acc.accountLabel,
      email: acc.email,
      displayName: acc.displayName,
      clientId: acc.clientId,
      hasClientSecret: Boolean(acc.clientSecret),
      hasRefreshToken: Boolean(acc.refreshToken),
      channelId: acc.channelId,
      status: acc.status as GoogleAccountResponseDto['status'],
      tokenExpiresAt: acc.tokenExpiresAt,
      createdAt: acc.createdAt,
      updatedAt: acc.updatedAt,
    };
  }
}
