import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Livestream, LivestreamStatus } from './entities/livestream.entity';
import {
  BroadcastSegment,
  BroadcastSegmentStatus,
} from './entities/broadcast-segment.entity';
import { EncoderService } from '../encoder/encoder.service';
import { EncoderNode } from '../encoder/entities/encoder-session.entity';
import { MediaService } from '../media/media.service';
import { LivestreamProgress } from './entities/livestream-progress.entity';
import {
  SystemConfigService,
  SYSTEM_KEYS,
} from '../system-config/system-config.service';
import { YouTubeLivestreamOrchestratorService } from '../youtube-api/youtube-livestream-orchestrator.service';

@Injectable()
export class BroadcastSegmentService {
  private readonly logger = new Logger(BroadcastSegmentService.name);

  constructor(
    @InjectRepository(Livestream)
    private readonly livestreamRepo: Repository<Livestream>,
    @InjectRepository(BroadcastSegment)
    private readonly segmentRepo: Repository<BroadcastSegment>,
    @InjectRepository(LivestreamProgress)
    private readonly progressRepo: Repository<LivestreamProgress>,
    private readonly youtubeOrchestrator: YouTubeLivestreamOrchestratorService,
    private readonly encoderService: EncoderService,
    private readonly systemConfigService: SystemConfigService,
    private readonly mediaService: MediaService,
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

  @Cron('*/30 * * * * *')
  async rotateDueSegments(): Promise<void> {
    const lead = await this.systemConfigService.getNumber(
      SYSTEM_KEYS.SEGMENT_LEAD_SEC,
      90,
    );

    const activeStreams = await this.livestreamRepo.find({
      where: { status: LivestreamStatus.LIVE },
    });

    for (const ls of activeStreams) {
      try {
        await this.maybeRotate(ls, lead);
      } catch (err) {
        this.logger.error(
          `Segment rotation error for livestream ${ls.id}: ${err.message}`,
        );
      }
    }
  }

  private async maybeRotate(ls: Livestream, leadSec: number): Promise<void> {
    const active = await this.segmentRepo.findOne({
      where: { livestreamId: ls.id, status: BroadcastSegmentStatus.ACTIVE },
      order: { segmentIndex: 'DESC' },
    });
    if (!active) return;

    const preparing = await this.segmentRepo.findOne({
      where: { livestreamId: ls.id, status: BroadcastSegmentStatus.PREPARING },
    });
    if (preparing) return;

    const threshold = active.plannedEndAt.getTime() - leadSec * 1000;
    if (Date.now() < threshold) return;

    await this.rotateToNextSegment(ls, active);
  }

  private async rotateToNextSegment(
    ls: Livestream,
    active: BroadcastSegment,
  ): Promise<void> {
    if (!ls.mediaFileId) {
      this.logger.warn(
        `Skip rotation for livestream ${ls.id}: no mediaFileId (runtime playlist mode not wired to encoder yet)`,
      );
      return;
    }

    const maxSec = await this.systemConfigService.getNumber(
      SYSTEM_KEYS.MAX_BROADCAST_DURATION_SEC,
      28800,
    );

    const youtubeSession =
      await this.youtubeOrchestrator.createAndBindBroadcast(
        ls.googleAccountId,
        {
          title: `${ls.title} #${active.segmentIndex + 1}`,
          description: ls.description,
          scheduledStartTime: new Date(),
          privacyStatus: ls.privacyStatus,
        },
      );

    const now = new Date();
    const plannedEnd = new Date(now.getTime() + maxSec * 1000);

    const next = this.segmentRepo.create({
      livestreamId: ls.id,
      segmentIndex: active.segmentIndex + 1,
      youtubeBroadcastId: youtubeSession.broadcastId,
      youtubeStreamId: youtubeSession.stream.streamId,
      youtubeStreamKey: youtubeSession.stream.streamKey,
      youtubeRtmpUrl: youtubeSession.stream.rtmpUrl,
      plannedStartAt: now,
      plannedEndAt: plannedEnd,
      status: BroadcastSegmentStatus.PREPARING,
    });
    const savedNext = await this.segmentRepo.save(next);

    await this.youtubeOrchestrator.waitForStreamReady(
      ls.googleAccountId,
      youtubeSession.stream.streamId,
    );

    const progress = await this.progressRepo.findOne({
      where: { livestreamId: ls.id },
      order: { updatedAt: 'DESC' },
    });
    const seekTo = progress?.currentTimestampStr || '00:00:00.000';

    const media = await this.mediaService.findById(ls.mediaFileId);

    await this.encoderService.stopEncoder(ls.id);
    ls.youtubeBroadcastId = youtubeSession.broadcastId;
    ls.youtubeStreamId = youtubeSession.stream.streamId;
    ls.youtubeStreamKey = youtubeSession.stream.streamKey;
    ls.youtubeRtmpUrl = youtubeSession.stream.rtmpUrl;
    ls.currentSegmentId = savedNext.id;
    await this.livestreamRepo.save(ls);

    await this.encoderService.startEncoder(
      ls,
      media,
      seekTo,
      EncoderNode.PRIMARY,
    );

    try {
      await this.youtubeOrchestrator.transitionBroadcast(
        ls.googleAccountId,
        active.youtubeBroadcastId,
        'complete',
      );
    } catch (err) {
      this.logger.warn(`Failed to complete old broadcast: ${err.message}`);
    }

    await this.youtubeOrchestrator.transitionBroadcast(
      ls.googleAccountId,
      youtubeSession.broadcastId,
      'testing',
    );
    await this.sleep(8000);
    await this.youtubeOrchestrator.transitionBroadcast(
      ls.googleAccountId,
      youtubeSession.broadcastId,
      'live',
    );

    active.status = BroadcastSegmentStatus.COMPLETED;
    await this.segmentRepo.save(active);

    savedNext.status = BroadcastSegmentStatus.ACTIVE;
    await this.segmentRepo.save(savedNext);

    this.logger.log(
      `Rotated livestream ${ls.id}: segment ${active.segmentIndex} -> ${savedNext.segmentIndex}`,
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
