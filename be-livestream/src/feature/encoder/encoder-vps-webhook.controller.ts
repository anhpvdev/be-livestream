import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppEnv } from '@/core/config/app-configs';
import { EncoderVpsService } from './encoder-vps.service';
import { RegisterEncoderVpsWebhookDto } from './dto/encoder-vps-webhook.dto';

@ApiTags('Webhooks')
@Controller('webhooks/encoder-vps')
export class EncoderVpsWebhookController {
  constructor(
    private readonly encoderVpsService: EncoderVpsService,
    private readonly configService: ConfigService<AppEnv>,
  ) {}

  @Post('register')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Encoder tự đăng ký / cập nhật VPS',
    description:
      'Authorization: Bearer <ENCODER_VPS_WEBHOOK_SECRET>. Upsert theo baseUrl.',
  })
  async register(
    @Headers('authorization') authorization: string | undefined,
    @Body() dto: RegisterEncoderVpsWebhookDto,
  ): Promise<{ ok: true; id: string; created: boolean }> {
    this.assertWebhookSecret(authorization);
    const result = await this.encoderVpsService.registerFromWebhook(dto);
    return { ok: true, ...result };
  }

  private assertWebhookSecret(authorization: string | undefined): void {
    const expected = this.configService.get<string>('ENCODER_VPS_WEBHOOK_SECRET');
    if (!expected?.trim()) {
      throw new ServiceUnavailableException(
        'ENCODER_VPS_WEBHOOK_SECRET chưa cấu hình — webhook đăng ký VPS tắt.',
      );
    }
    const prefix = 'Bearer ';
    const token =
      authorization?.startsWith(prefix) ?
        authorization.slice(prefix.length).trim()
      : '';
    const a = Buffer.from(token, 'utf8');
    const b = Buffer.from(expected.trim(), 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException();
    }
  }
}
