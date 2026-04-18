import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { EncoderVps } from './entities/encoder-vps.entity';
import { Livestream, LivestreamStatus } from '../livestream/entities/livestream.entity';
import { UpdateEncoderVpsDto } from './dto/encoder-vps.dto';
import { RegisterEncoderVpsWebhookDto } from './dto/encoder-vps-webhook.dto';
import { EncoderVpsStatus } from './dto/list-encoder-vps-query.dto';

export type EncoderVpsListItem = {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  encoderNode: string | null;
  lastSeenAt: Date | null;
  status: 'live' | 'error' | 'ok' | '0';
  isFree: boolean;
  busyAs: 'primary' | 'backup' | null;
  busyLivestreamId: string | null;
};

@Injectable()
export class EncoderVpsService {
  constructor(
    @InjectRepository(EncoderVps)
    private readonly vpsRepo: Repository<EncoderVps>,
    @InjectRepository(Livestream)
    private readonly livestreamRepo: Repository<Livestream>,
  ) {}

  normalizeBaseUrl(raw: string): string {
    return raw.trim().replace(/\/+$/, '');
  }

  /**
   * Đăng ký từ encoder (webhook): đã có baseUrl thì cập nhật lastSeen + node + name; chưa có thì tạo mới.
   */
  async registerFromWebhook(
    dto: RegisterEncoderVpsWebhookDto,
  ): Promise<{ id: string; created: boolean }> {
    const base = this.normalizeBaseUrl(dto.baseUrl);
    const now = new Date();
    let existing = await this.vpsRepo.findOne({ where: { baseUrl: base } });
    if (existing) {
      existing.lastSeenAt = now;
      existing.encoderNode = dto.node;
      if (dto.name?.trim()) {
        existing.name = dto.name.trim();
      }
      await this.vpsRepo.save(existing);
      return { id: existing.id, created: false };
    }
    const row = this.vpsRepo.create({
      name: dto.name?.trim() || `encoder-${dto.node}`,
      baseUrl: base,
      encoderNode: dto.node,
      lastSeenAt: now,
      enabled: true,
    });
    try {
      await this.vpsRepo.save(row);
      return { id: row.id, created: true };
    } catch {
      existing = await this.vpsRepo.findOne({ where: { baseUrl: base } });
      if (!existing) {
        throw new BadRequestException('Không thể tạo bản ghi VPS (trùng base_url?)');
      }
      existing.lastSeenAt = now;
      existing.encoderNode = dto.node;
      if (dto.name?.trim()) {
        existing.name = dto.name.trim();
      }
      await this.vpsRepo.save(existing);
      return { id: existing.id, created: false };
    }
  }

  async update(id: string, dto: UpdateEncoderVpsDto): Promise<EncoderVps> {
    const row = await this.vpsRepo.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException(`Encoder VPS ${id} not found`);
    }
    if (dto.name !== undefined) row.name = dto.name.trim();
    if (dto.baseUrl !== undefined) row.baseUrl = this.normalizeBaseUrl(dto.baseUrl);
    if (dto.enabled !== undefined) row.enabled = dto.enabled;
    return this.vpsRepo.save(row);
  }

  async remove(id: string): Promise<void> {
    const row = await this.vpsRepo.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException(`Encoder VPS ${id} not found`);
    }
    const occupied = await this.livestreamRepo.findOne({
      where: [
        {
          primaryEncoderVpsId: id,
          status: In([LivestreamStatus.LIVE, LivestreamStatus.TESTING]),
        },
        {
          backupEncoderVpsId: id,
          status: In([LivestreamStatus.LIVE, LivestreamStatus.TESTING]),
        },
      ],
      select: ['id'],
    });
    if (occupied) {
      throw new ConflictException(
        `Không thể xóa VPS đang được livestream ${occupied.id} sử dụng`,
      );
    }
    await this.vpsRepo.delete({ id });
  }

  async findById(id: string): Promise<EncoderVps | null> {
    return this.vpsRepo.findOne({ where: { id } });
  }

  async findByIdOrThrow(id: string): Promise<EncoderVps> {
    const row = await this.findById(id);
    if (!row) {
      throw new NotFoundException(`Encoder VPS ${id} not found`);
    }
    return row;
  }

  /** URL điều khiển stream-encoder (health/stop/probe); null nếu không tồn tại hoặc disabled. */
  async getResolvedBaseUrl(vpsId: string): Promise<string | null> {
    const row = await this.findById(vpsId);
    if (!row?.enabled) return null;
    return this.normalizeBaseUrl(row.baseUrl);
  }

  async assertUsablePair(primaryId: string, backupId: string): Promise<void> {
    if (primaryId === backupId) {
      throw new BadRequestException(
        'primaryEncoderVpsId và backupEncoderVpsId phải khác nhau',
      );
    }
    const [a, b] = await Promise.all([
      this.vpsRepo.findOne({ where: { id: primaryId } }),
      this.vpsRepo.findOne({ where: { id: backupId } }),
    ]);
    if (!a || !b) {
      throw new BadRequestException('Một hoặc hai VPS encoder không tồn tại');
    }
    if (!a.enabled || !b.enabled) {
      throw new BadRequestException('VPS encoder bị tắt (enabled=false)');
    }

    const busyStreams = await this.livestreamRepo.find({
      where: {
        status: In([LivestreamStatus.LIVE, LivestreamStatus.TESTING]),
      },
      select: ['id', 'primaryEncoderVpsId', 'backupEncoderVpsId'],
    });
    const assertNotBusy = (vpsId: string, role: 'primary' | 'backup'): void => {
      const occupied = busyStreams.find(
        (ls) => ls.primaryEncoderVpsId === vpsId || ls.backupEncoderVpsId === vpsId,
      );
      if (!occupied) return;
      throw new BadRequestException(
        `VPS ${role} đang được livestream ${occupied.id} sử dụng`,
      );
    };

    assertNotBusy(primaryId, 'primary');
    assertNotBusy(backupId, 'backup');
  }

  /**
   * Danh sách VPS + trạng thái free / đang gán cho livestream LIVE hoặc TESTING.
   */
  async listWithUsage(filter?: {
    status?: EncoderVpsStatus;
    enabled?: boolean;
    isFree?: boolean;
  }): Promise<EncoderVpsListItem[]> {
    const all = await this.vpsRepo.find({ order: { createdAt: 'DESC' } });
    const streams = await this.livestreamRepo.find({
      where: {
        status: In([LivestreamStatus.LIVE, LivestreamStatus.TESTING]),
      },
      select: [
        'id',
        'primaryEncoderVpsId',
        'backupEncoderVpsId',
        'status',
      ],
    });

    const usage = new Map<
      string,
      { role: 'primary' | 'backup'; livestreamId: string }
    >();
    for (const ls of streams) {
      if (ls.primaryEncoderVpsId) {
        usage.set(ls.primaryEncoderVpsId, {
          role: 'primary',
          livestreamId: ls.id,
        });
      }
      if (ls.backupEncoderVpsId) {
        usage.set(ls.backupEncoderVpsId, {
          role: 'backup',
          livestreamId: ls.id,
        });
      }
    }

    const items = all.map((v) => {
      const u = usage.get(v.id);
      return {
        id: v.id,
        name: v.name,
        baseUrl: v.baseUrl,
        enabled: v.enabled,
        encoderNode: v.encoderNode ?? null,
        lastSeenAt: v.lastSeenAt ?? null,
        status: this.resolveVpsStatus(v, !!u),
        isFree: !u,
        busyAs: u?.role ?? null,
        busyLivestreamId: u?.livestreamId ?? null,
      };
    });
    return items.filter((item) => {
      if (filter?.status && item.status !== filter.status) return false;
      if (filter?.enabled !== undefined && item.enabled !== filter.enabled) return false;
      if (filter?.isFree !== undefined && item.isFree !== filter.isFree) return false;
      return true;
    });
  }

  private resolveVpsStatus(vps: EncoderVps, isBusy: boolean): 'live' | 'error' | 'ok' | '0' {
    if (!vps.enabled || !vps.lastSeenAt) return '0';
    if (Date.now() - vps.lastSeenAt.getTime() > 30000) return 'error';
    if (isBusy) return 'live';
    return 'ok';
  }
}
