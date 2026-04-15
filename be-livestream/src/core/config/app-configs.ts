import { z } from 'zod';

const booleanString = z.enum(['true', 'false']);

export const appConfigs = z
  .object({
    APP_NAME: z.string().default('Backend Boilerplate'),
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).default(3000),
    API_PREFIX: z.string().default('api'),
    SWAGGER_ENABLED: booleanString.default('false'),
    SWAGGER_USERNAME: z.string().optional(),
    SWAGGER_PASSWORD: z.string().min(6).optional(),
    CORS_ORIGINS: z.string().default('*'),

    POSTGRES_HOST: z.string().default('localhost'),
    POSTGRES_PORT: z.coerce.number().int().default(5432),
    POSTGRES_DB: z.string().min(1),
    POSTGRES_USER: z.string().min(1),
    POSTGRES_PASSWORD: z.string().min(1),
    DB_SYNCHRONIZE: booleanString.default('false'),
    DB_LOGGING: booleanString.default('false'),

    ROOT_ADMIN_USERNAME: z.string().min(1),
    ROOT_ADMIN_EMAIL: z.string().email(),
    ROOT_ADMIN_PASSWORD: z.string().min(1),

    ENCODER_PRIMARY_URL: z.string().url().default('http://localhost:8080'),
    ENCODER_BACKUP_URL: z.string().url().default('http://localhost:8081'),
    ENCODER_MONITOR_URL: z.string().url().default('http://localhost:8090'),
    ENCODER_HEALTH_INTERVAL_MS: z.coerce.number().int().default(3000),
    ENCODER_HEALTH_TIMEOUT_MS: z.coerce.number().int().default(10000),
    ENCODER_FAILOVER_THRESHOLD: z.coerce.number().int().default(3),

    MEDIA_MAX_FILE_SIZE: z.coerce.number().int().default(10737418240),
  })
  .superRefine((data, ctx) => {
    if (data.SWAGGER_ENABLED === 'true') {
      if (!data.SWAGGER_USERNAME) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'SWAGGER_USERNAME is required when SWAGGER_ENABLED is true',
          path: ['SWAGGER_USERNAME'],
        });
      }

      if (!data.SWAGGER_PASSWORD) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'SWAGGER_PASSWORD is required when SWAGGER_ENABLED is true',
          path: ['SWAGGER_PASSWORD'],
        });
      }
    }
  });

export type AppConfigs = z.infer<typeof appConfigs>;
export type AppEnv = AppConfigs;

export const validateAppEnv = (config: Record<string, unknown>): AppConfigs =>
  appConfigs.parse(config);
