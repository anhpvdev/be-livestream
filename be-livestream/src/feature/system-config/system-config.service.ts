import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { SystemConfig } from './entities/system-config.entity';

export const SYSTEM_KEYS = {
  MAX_BROADCAST_DURATION_SEC: 'livestream.max_broadcast_duration_sec',
  SEGMENT_LEAD_SEC: 'livestream.segment_lead_sec',
} as const;

const DEFAULTS: Record<string, Record<string, unknown>> = {
  [SYSTEM_KEYS.MAX_BROADCAST_DURATION_SEC]: { v: 28800 },
  [SYSTEM_KEYS.SEGMENT_LEAD_SEC]: { v: 90 },
};

const LEGACY_UNUSED_KEYS = [
  'encoder.music_crossfade_ms',
  'livestream.image_default_duration_sec',
  'livestream.cutover_target_sec',
] as const;

@Injectable()
export class SystemConfigService implements OnModuleInit {
  private readonly logger = new Logger(SystemConfigService.name);

  constructor(
    @InjectRepository(SystemConfig)
    private readonly repo: Repository<SystemConfig>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.repo.delete({
      key: In([...LEGACY_UNUSED_KEYS]),
    });

    for (const [key, value] of Object.entries(DEFAULTS)) {
      const exists = await this.repo.findOne({ where: { key } });
      if (!exists) {
        await this.repo.save(this.repo.create({ key, value }));
        this.logger.log(`Seeded system_config: ${key}`);
      }
    }
  }

  async getByKey(key: string): Promise<SystemConfig | null> {
    return this.repo.findOne({ where: { key } });
  }

  async getNumber(key: string, fallback: number): Promise<number> {
    const row = await this.repo.findOne({ where: { key } });
    const v = row?.value?.v;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
    return fallback;
  }

  async getJson<T = Record<string, unknown>>(key: string): Promise<T | null> {
    const row = await this.repo.findOne({ where: { key } });
    return (row?.value as T) ?? null;
  }

  async setByKey(
    key: string,
    value: Record<string, unknown>,
  ): Promise<SystemConfig> {
    let row = await this.repo.findOne({ where: { key } });
    if (!row) {
      row = this.repo.create({ key, value });
    } else {
      row.value = value;
    }
    return this.repo.save(row);
  }

  async listAll(): Promise<SystemConfig[]> {
    return this.repo.find({ order: { key: 'ASC' } });
  }
}
