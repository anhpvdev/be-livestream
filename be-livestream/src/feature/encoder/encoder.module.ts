import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EncoderSession } from './entities/encoder-session.entity';
import { EncoderJob } from './entities/encoder-job.entity';
import { LivestreamProgress } from '../livestream/entities/livestream-progress.entity';
import { Livestream } from '../livestream/entities/livestream.entity';
import { MediaFile } from '../media/entities/media.entity';
import { EncoderService } from './encoder.service';
import { EncoderHealthService } from './encoder-health.service';
import { EncoderFailoverService } from './encoder-failover.service';
import { EncoderMonitorService } from './encoder-monitor.service';
import { EncoderMonitorController } from './encoder-monitor.controller';
import { EncoderJobController } from './encoder-job.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      EncoderSession,
      EncoderJob,
      LivestreamProgress,
      Livestream,
      MediaFile,
    ]),
  ],
  controllers: [EncoderMonitorController, EncoderJobController],
  providers: [
    EncoderService,
    EncoderHealthService,
    EncoderFailoverService,
    EncoderMonitorService,
  ],
  exports: [EncoderService, EncoderHealthService, EncoderFailoverService],
})
export class EncoderModule {}
