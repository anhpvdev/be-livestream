import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LivestreamProfile } from './entities/livestream-profile.entity';
import { LivestreamProfileController } from './livestream-profile.controller';
import { LivestreamProfileService } from './livestream-profile.service';
import { MediaModule } from '../media/media.module';
import { Livestream } from '../livestream/entities/livestream.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([LivestreamProfile, Livestream]),
    MediaModule,
  ],
  controllers: [LivestreamProfileController],
  providers: [LivestreamProfileService],
  exports: [LivestreamProfileService],
})
export class LivestreamProfileModule {}
