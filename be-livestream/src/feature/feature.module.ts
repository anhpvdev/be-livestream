import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module';
import { GoogleAccountModule } from './google-account/google-account.module';
import { MediaModule } from './media/media.module';
import { LivestreamModule } from './livestream/livestream.module';
import { EncoderModule } from './encoder/encoder.module';
import { SystemConfigModule } from './system-config/system-config.module';
import { LivestreamProfileModule } from './livestream-profile/livestream-profile.module';

@Module({
  imports: [
    CoreModule,
    GoogleAccountModule,
    MediaModule,
    LivestreamModule,
    LivestreamProfileModule,
    EncoderModule,
    SystemConfigModule,
  ],
  exports: [],
})
export class FeatureModule {}
