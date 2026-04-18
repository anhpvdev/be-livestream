import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  ENGINE_DB_POLL_MS: z.coerce.number().int().default(2000),
  ENGINE_FFMPEG_BIN: z.string().default('ffmpeg'),
  ENGINE_PREFETCH_ENABLED: z.enum(['true', 'false']).default('true'),
  ENGINE_PREFETCH_LOG_SKIPS: z.enum(['true', 'false']).default('false'),
  ENGINE_CACHE_DIR: z.string().default('/tmp/encoder-cache'),
  ENGINE_OWNER_LEASE_MS: z.coerce.number().int().positive().default(6000),
  ENGINE_OUTPUT_FPS: z.coerce.number().int().positive().default(30),
  ENGINE_OUTPUT_GOP_SEC: z.coerce.number().int().positive().max(4).default(2),
  ENGINE_OUTPUT_VIDEO_BITRATE_KBPS: z.coerce.number().int().positive().default(6800),
  ENGINE_OUTPUT_MAXRATE_KBPS: z.coerce.number().int().positive().default(6800),
  ENGINE_OUTPUT_BUFSIZE_KBPS: z.coerce.number().int().positive().default(13600),
  ENGINE_OUTPUT_AUDIO_BITRATE_KBPS: z.coerce.number().int().positive().default(128),
  POSTGRES_HOST: z.string().default('localhost'),
  POSTGRES_PORT: z.coerce.number().int().default(5432),
  POSTGRES_DB: z.string().min(1),
  POSTGRES_USER: z.string().min(1),
  POSTGRES_PASSWORD: z.string().min(1),

  /** POST tới BE để upsert encoder_vps (vd: http://localhost:3000/api/webhooks/encoder-vps/register). Để trống = không gọi. */
  BACKEND_ENCODER_VPS_REGISTER_URL: z.string().optional().default(''),
  BACKEND_ENCODER_VPS_REGISTER_SECRET: z.string().optional().default(''),
  /** Chu kỳ heartbeat webhook đăng ký VPS (ms). 0 = tắt heartbeat định kỳ. */
  BACKEND_ENCODER_VPS_HEARTBEAT_MS: z.coerce.number().int().nonnegative().default(15000),
  /** URL công khai tới chính instance này (BE health/stop). Bắt buộc nếu bật đăng ký. */
  ENCODER_PUBLIC_BASE_URL: z.string().optional().default(''),
  /** Tên hiển thị tùy chọn khi đăng ký VPS. */
  ENCODER_VPS_DISPLAY_NAME: z.string().optional().default(''),
  /**
   * UUID bản ghi encoder_vps trên BE. Bắt buộc khi nhiều encoder cùng DB:
   * chỉ xử lý livestream có primary_encoder_vps_id hoặc backup_encoder_vps_id trùng giá trị này.
   * Có thể đặt tay hoặc để trống và nhận từ webhook đăng ký (response `id`).
   */
  ENCODER_VPS_ID: z.string().optional().default(''),
});

export type EngineEnv = z.infer<typeof envSchema>;

export const validateEnv = (config: Record<string, unknown>): EngineEnv =>
  envSchema.parse(config);
