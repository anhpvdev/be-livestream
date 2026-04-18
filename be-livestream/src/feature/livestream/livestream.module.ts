import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Livestream } from './entities/livestream.entity';
import { LivestreamProgress } from './entities/livestream-progress.entity';
import { BroadcastSegment } from './entities/broadcast-segment.entity';
import { LivestreamController } from './livestream.controller';
import { LivestreamService } from './livestream.service';
import { BroadcastSegmentService } from './broadcast-segment.service';
import { YouTubeApiModule } from '../youtube-api/youtube-api.module';
import { GoogleAccountModule } from '../google-account/google-account.module';
import { MediaModule } from '../media/media.module';
import { EncoderModule } from '../encoder/encoder.module';
import { LivestreamProfileModule } from '../livestream-profile/livestream-profile.module';
import { EncoderJob } from '../encoder/entities/encoder-job.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Livestream,
      LivestreamProgress,
      BroadcastSegment,
      EncoderJob,
    ]),
    YouTubeApiModule,
    GoogleAccountModule,
    MediaModule,
    LivestreamProfileModule,
    forwardRef(() => EncoderModule),
  ],
  controllers: [LivestreamController],
  providers: [LivestreamService, BroadcastSegmentService],
  exports: [LivestreamService],
})
export class LivestreamModule {}
