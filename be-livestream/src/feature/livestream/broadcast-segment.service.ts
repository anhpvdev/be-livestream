import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Livestream } from './entities/livestream.entity';
import {
  BroadcastSegment,
  BroadcastSegmentStatus,
} from './entities/broadcast-segment.entity';

@Injectable()
export class BroadcastSegmentService {
  constructor(
    @InjectRepository(Livestream)
    private readonly livestreamRepo: Repository<Livestream>,
    @InjectRepository(BroadcastSegment)
    private readonly segmentRepo: Repository<BroadcastSegment>,
  ) {}

  async recordInitialSegment(params: {
    livestream: Livestream;
  }): Promise<BroadcastSegment> {
    const now = new Date();

    const segment = this.segmentRepo.create({
      livestreamId: params.livestream.id,
      segmentIndex: 0,
      youtubeBroadcastId: params.livestream.youtubeBroadcastId,
      youtubeStreamId: params.livestream.youtubeStreamId,
      youtubeStreamKey: params.livestream.youtubeStreamKey,
      youtubeRtmpUrl: params.livestream.youtubeRtmpUrl,
      plannedStartAt: now,
      plannedEndAt: null,
      status: BroadcastSegmentStatus.ACTIVE,
    });
    const saved = await this.segmentRepo.save(segment);

    params.livestream.currentSegmentId = saved.id;
    await this.livestreamRepo.save(params.livestream);

    return saved;
  }

}
