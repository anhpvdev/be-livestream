import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EngineEnv } from './config/env.schema';
import { EncoderVpsBindingService } from './engine/encoder-vps-binding.service';
import { EngineIdentityService } from './engine/engine-identity.service';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Khi encoder khởi động: gọi webhook BE để upsert bản ghi VPS (user không cần thêm tay).
 */
@Injectable()
export class BackendRegisterService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BackendRegisterService.name);
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly config: ConfigService<EngineEnv>,
    private readonly identity: EngineIdentityService,
    private readonly encoderVpsBinding: EncoderVpsBindingService,
  ) {}

  onModuleInit(): void {
    void this.registerWithRetries();
    const heartbeatMs = this.config.get<number>('BACKEND_ENCODER_VPS_HEARTBEAT_MS', 15000);
    if (heartbeatMs > 0) {
      this.heartbeatTimer = setInterval(() => {
        void this.registerOnce(false);
      }, heartbeatMs);
      this.logger.log(`Bật heartbeat đăng ký VPS định kỳ mỗi ${heartbeatMs}ms`);
    }
  }

  onModuleDestroy(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async registerWithRetries(): Promise<void> {
    for (let attempt = 1; attempt <= 4; attempt++) {
      const ok = await this.registerOnce(true, attempt);
      if (ok) return;
      if (attempt < 4) {
        await sleep(5000);
      }
    }
  }

  private async registerOnce(
    isStartup: boolean,
    attempt = 1,
  ): Promise<boolean> {
    const url = (this.config.get('BACKEND_ENCODER_VPS_REGISTER_URL') || '').trim();
    const secret = (
      this.config.get('BACKEND_ENCODER_VPS_REGISTER_SECRET') || ''
    ).trim();
    const publicBase = (this.config.get('ENCODER_PUBLIC_BASE_URL') || '').trim();
    const displayName = (this.config.get('ENCODER_VPS_DISPLAY_NAME') || '').trim();

    if (!url || !secret || !publicBase) {
      if (isStartup) {
        this.logger.log(
          'Bỏ qua đăng ký VPS: thiếu BACKEND_ENCODER_VPS_REGISTER_URL / SECRET / ENCODER_PUBLIC_BASE_URL',
        );
      }
      return false;
    }

    const body = {
      baseUrl: publicBase.replace(/\/+$/, ''),
      node: this.identity.nodeId,
      ...(displayName ? { name: displayName } : {}),
    };

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) {
        this.logger.warn(
          `Đăng ký VPS ${isStartup ? `lần ${attempt}` : 'heartbeat'}: HTTP ${res.status} ${text.slice(0, 200)}`,
        );
        return false;
      }
      try {
        const data = JSON.parse(text) as { id?: string };
        if (data?.id) {
          this.encoderVpsBinding.setEncoderVpsIdFromRegistration(data.id);
        }
      } catch {
        // response không phải JSON — bỏ qua gắn id
      }
      if (isStartup) {
        this.logger.log(`Đã đăng ký VPS với BE: ${text.slice(0, 120)}`);
      }
      return true;
    } catch (err) {
      this.logger.warn(
        `Đăng ký VPS ${isStartup ? `lần ${attempt}` : 'heartbeat'} lỗi: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }
}
