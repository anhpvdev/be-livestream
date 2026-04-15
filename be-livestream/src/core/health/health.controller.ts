import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmHealthIndicator } from '@nestjs/terminus';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AppEnv } from '../config/app-configs';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly db: TypeOrmHealthIndicator,
    private readonly configService: ConfigService<AppEnv>,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Health check cho DB + encoder primary/backup' })
  @ApiResponse({
    status: 200,
    description: 'All services are healthy',
  })
  @ApiResponse({
    status: 503,
    description: 'One or more services are unhealthy',
  })
  async check() {
    const primaryUrl = this.configService.get<string>('ENCODER_PRIMARY_URL');
    const backupUrl = this.configService.get<string>('ENCODER_BACKUP_URL');
    const timeoutMs =
      this.configService.get<number>('ENCODER_HEALTH_TIMEOUT_MS') ?? 5000;

    const [dbResult, primaryResult, backupResult] = await Promise.all([
      this.pingDb(),
      this.pingEncoder('primary', primaryUrl, timeoutMs),
      this.pingEncoder('backup', backupUrl, timeoutMs),
    ]);

    const allUp = dbResult.up && primaryResult.up && backupResult.up;
    const payload = {
      status: allUp ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
      checks: {
        postgresql: dbResult,
        encoderPrimary: primaryResult,
        encoderBackup: backupResult,
      },
    };

    if (!allUp) {
      throw new ServiceUnavailableException(payload);
    }

    return payload;
  }

  private async pingDb(): Promise<{
    up: boolean;
    detail?: unknown;
    error?: string;
  }> {
    try {
      const detail = await this.db.pingCheck('postgresql');
      return { up: true, detail };
    } catch (error: unknown) {
      return {
        up: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async pingEncoder(
    node: 'primary' | 'backup',
    baseUrl: string | undefined,
    timeoutMs: number,
  ): Promise<{
    up: boolean;
    node: 'primary' | 'backup';
    detail?: unknown;
    error?: string;
  }> {
    if (!baseUrl) {
      return { up: false, node, error: 'Missing encoder URL config' };
    }

    const candidateUrls = this.getCandidateEncoderUrls(baseUrl);
    let lastError = 'Unknown error';
    for (const candidate of candidateUrls) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const response = await fetch(`${candidate}/health`, {
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (!response.ok) {
          lastError = `HTTP ${response.status} (${candidate})`;
          continue;
        }

        return {
          up: true,
          node,
          detail: await response.json(),
        };
      } catch (error: unknown) {
        lastError = `${error instanceof Error ? error.message : String(error)} (${candidate})`;
      }
    }

    return {
      up: false,
      node,
      error: lastError,
    };
  }

  private getCandidateEncoderUrls(baseUrl: string): string[] {
    const normalized = baseUrl.replace(/\/+$/, '');
    const candidates = [normalized];

    // Khi app chạy trong Docker, localhost thường trỏ vào chính container app.
    if (
      normalized.includes('://localhost') ||
      normalized.includes('://127.0.0.1')
    ) {
      candidates.push(
        normalized
          .replace('://localhost', '://host.docker.internal')
          .replace('://127.0.0.1', '://host.docker.internal'),
      );
    }

    return Array.from(new Set(candidates));
  }
}
