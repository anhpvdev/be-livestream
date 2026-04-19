import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LivestreamProfile } from './entities/livestream-profile.entity';
import { LivestreamProfileController } from './livestream-profile.controller';
import { LivestreamProfileService } from './livestream-profile.service';
import { ProfileLiveSyncService } from './profile-live-sync.service';
import { MediaModule } from '../media/media.module';
import { YouTubeApiModule } from '../youtube-api/youtube-api.module';
import { Livestream } from '../livestream/entities/livestream.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([LivestreamProfile, Livestream]),
    MediaModule,
    YouTubeApiModule,
  ],
  controllers: [LivestreamProfileController],
  providers: [LivestreamProfileService, ProfileLiveSyncService],
  exports: [LivestreamProfileService],
})
export class LivestreamProfileModule {}
