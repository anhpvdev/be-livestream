import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppEnv } from '@/core/config/app-configs';

@Injectable()
export class EncoderMonitorService {
  private readonly monitorUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly configService: ConfigService<AppEnv>) {
    this.monitorUrl = this.configService.get('ENCODER_MONITOR_URL');
    this.timeoutMs = this.configService.get<number>(
      'ENCODER_HEALTH_TIMEOUT_MS',
    );
  }

  async getMetrics(minutes: number): Promise<unknown> {
    const endpoint = new URL('/metrics/avg', this.monitorUrl);
    endpoint.searchParams.set('minutes', String(minutes));
    return this.fetchJsonWithFallback(endpoint.toString());
  }

  async getCurrentMetrics(): Promise<unknown> {
    const endpoint = new URL('/metrics/current', this.monitorUrl);
    return this.fetchJsonWithFallback(endpoint.toString());
  }

  private async fetchJsonWithFallback(url: string): Promise<unknown> {
    const response = await this.fetchWithFallback(url);
    if (!response.ok) {
      throw new ServiceUnavailableException('Encoder monitor không phản hồi');
    }
    return response.json() as Promise<unknown>;
  }

  private async fetchWithFallback(url: string): Promise<Response> {
    try {
      return await this.fetchWithTimeout(url);
    } catch {
      const fallbackUrl = this.toDockerHostUrl(url);
      if (!fallbackUrl) {
        throw new ServiceUnavailableException(
          'Không kết nối được encoder monitor',
        );
      }
      return this.fetchWithTimeout(fallbackUrl);
    }
  }

  private async fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private toDockerHostUrl(rawUrl: string): string | null {
    const url = new URL(rawUrl);
    if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      return null;
    }
    url.hostname = 'host.docker.internal';
    return url.toString();
  }
}
