import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EngineEnv } from '../config/env.schema';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseUuid(raw: string | undefined): string | null {
  const s = raw?.trim();
  if (!s) return null;
  return UUID_RE.test(s) ? s : null;
}

/**
 * UUID encoder_vps trên BE — dùng để không nhận job của livestream mà instance này không phải primary/backup.
 */
@Injectable()
export class EncoderVpsBindingService {
  private readonly logger = new Logger(EncoderVpsBindingService.name);
  private _encoderVpsId: string | null;

  constructor(private readonly config: ConfigService<EngineEnv>) {
    this._encoderVpsId = parseUuid(this.config.get<string>('ENCODER_VPS_ID'));
    if (this._encoderVpsId) {
      this.logger.log(`ENCODER_VPS_ID=${this._encoderVpsId} (chỉ nhận job livestream gán VPS này làm primary hoặc backup)`);
    }
  }

  get encoderVpsId(): string | null {
    return this._encoderVpsId;
  }

  /** Gọi khi webhook đăng ký VPS trả về `id` (ưu tiên đồng bộ với BE). */
  setEncoderVpsIdFromRegistration(id: string): void {
    const parsed = parseUuid(id);
    if (!parsed) return;
    if (this._encoderVpsId !== parsed) {
      this.logger.log(
        `encoderVpsId từ đăng ký BE: ${parsed} (chỉ nhận job livestream có primary/backup trùng id này)`,
      );
    }
    this._encoderVpsId = parsed;
  }
}
