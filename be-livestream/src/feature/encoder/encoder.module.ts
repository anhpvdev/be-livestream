import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EncoderSession } from './entities/encoder-session.entity';
import { EncoderJob } from './entities/encoder-job.entity';
import { EncoderVps } from './entities/encoder-vps.entity';
import { LivestreamProgress } from '../livestream/entities/livestream-progress.entity';
import { Livestream } from '../livestream/entities/livestream.entity';
import { MediaFile } from '../media/entities/media.entity';
import { EncoderService } from './encoder.service';
import { EncoderHealthService } from './encoder-health.service';
import { EncoderFailoverService } from './encoder-failover.service';
import { EncoderJobController } from './encoder-job.controller';
import { EncoderVpsService } from './encoder-vps.service';
import { EncoderVpsController } from './encoder-vps.controller';
import { EncoderVpsWebhookController } from './encoder-vps-webhook.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      EncoderSession,
      EncoderJob,
      EncoderVps,
      LivestreamProgress,
      Livestream,
      MediaFile,
    ]),
  ],
  controllers: [
    EncoderJobController,
    EncoderVpsController,
    EncoderVpsWebhookController,
  ],
  providers: [
    EncoderVpsService,
    EncoderService,
    EncoderHealthService,
    EncoderFailoverService,
  ],
  exports: [
    EncoderService,
    EncoderHealthService,
    EncoderFailoverService,
    EncoderVpsService,
  ],
})
export class EncoderModule {}
