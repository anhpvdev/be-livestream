import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Livestream } from './entities/livestream.entity';
import {
  BroadcastSegment,
  BroadcastSegmentStatus,
} from './entities/broadcast-segment.entity';
import {
  SystemConfigService,
  SYSTEM_KEYS,
} from '../system-config/system-config.service';

@Injectable()
export class BroadcastSegmentService {
  constructor(
    @InjectRepository(Livestream)
    private readonly livestreamRepo: Repository<Livestream>,
    @InjectRepository(BroadcastSegment)
    private readonly segmentRepo: Repository<BroadcastSegment>,
    private readonly systemConfigService: SystemConfigService,
  ) {}

  async recordInitialSegment(params: {
    livestream: Livestream;
  }): Promise<BroadcastSegment> {
    const maxSec = await this.systemConfigService.getNumber(
      SYSTEM_KEYS.MAX_BROADCAST_DURATION_SEC,
      28800,
    );
    const now = new Date();
    const plannedEnd = new Date(now.getTime() + maxSec * 1000);

    const segment = this.segmentRepo.create({
      livestreamId: params.livestream.id,
      segmentIndex: 0,
      youtubeBroadcastId: params.livestream.youtubeBroadcastId,
      youtubeStreamId: params.livestream.youtubeStreamId,
      youtubeStreamKey: params.livestream.youtubeStreamKey,
      youtubeRtmpUrl: params.livestream.youtubeRtmpUrl,
      plannedStartAt: now,
      plannedEndAt: plannedEnd,
      status: BroadcastSegmentStatus.ACTIVE,
    });
    const saved = await this.segmentRepo.save(segment);

    params.livestream.currentSegmentId = saved.id;
    await this.livestreamRepo.save(params.livestream);

    return saved;
  }

}
