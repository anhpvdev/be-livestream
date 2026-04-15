import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EncoderService } from './encoder.service';
import { EncoderNode } from './entities/encoder-session.entity';
import { LivestreamProgress } from '../livestream/entities/livestream-progress.entity';
import {
  Livestream,
  LivestreamStatus,
} from '../livestream/entities/livestream.entity';
import { MediaFile } from '../media/entities/media.entity';

@Injectable()
export class EncoderFailoverService {
  private readonly logger = new Logger(EncoderFailoverService.name);

  constructor(
    private readonly encoderService: EncoderService,
    @InjectRepository(LivestreamProgress)
    private readonly progressRepo: Repository<LivestreamProgress>,
    @InjectRepository(Livestream)
    private readonly livestreamRepo: Repository<Livestream>,
  ) {}

  async executeFailover(
    livestream: Livestream,
    media: MediaFile,
    failedNode: EncoderNode,
  ): Promise<void> {
    const backupNode =
      failedNode === EncoderNode.PRIMARY
        ? EncoderNode.BACKUP
        : EncoderNode.PRIMARY;

    const progress = await this.progressRepo.findOne({
      where: { livestreamId: livestream.id },
      order: { updatedAt: 'DESC' },
    });

    const seekTo = progress?.currentTimestampStr || '00:00:00.000';

    this.logger.log(
      `Executing failover for livestream ${livestream.id}: ` +
        `[${failedNode}] -> [${backupNode}] at ${seekTo}`,
    );

    try {
      await this.encoderService.startEncoder(
        livestream,
        media,
        seekTo,
        backupNode,
      );

      livestream.status = LivestreamStatus.LIVE;
      await this.livestreamRepo.save(livestream);

      this.logger.log(
        `Failover complete: livestream ${livestream.id} resumed on [${backupNode}] from ${seekTo}`,
      );
    } catch (err) {
      livestream.status = LivestreamStatus.ERROR;
      await this.livestreamRepo.save(livestream);

      this.logger.error(
        `Failover failed for livestream ${livestream.id}: ${err.message}`,
      );
      throw err;
    }
  }
}
