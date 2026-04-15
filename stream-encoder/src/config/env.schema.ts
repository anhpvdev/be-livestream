import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(8080),
  ENGINE_NODE: z.string().default('primary'),
  ENGINE_DB_POLL_MS: z.coerce.number().int().default(2000),
  ENGINE_FFMPEG_BIN: z.string().default('ffmpeg'),
  ENGINE_PREFETCH_ENABLED: z.enum(['true', 'false']).default('true'),
  ENGINE_PREFETCH_LOG_SKIPS: z.enum(['true', 'false']).default('false'),
  ENGINE_CACHE_DIR: z.string().default('/tmp/encoder-cache'),
  POSTGRES_HOST: z.string().default('localhost'),
  POSTGRES_PORT: z.coerce.number().int().default(5432),
  POSTGRES_DB: z.string().min(1),
  POSTGRES_USER: z.string().min(1),
  POSTGRES_PASSWORD: z.string().min(1),
});

export type EngineEnv = z.infer<typeof envSchema>;

export const validateEnv = (config: Record<string, unknown>): EngineEnv =>
  envSchema.parse(config);
