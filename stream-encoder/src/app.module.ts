import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.schema';
import { BackendRegisterService } from './backend-register.service';
import { EncoderVpsBindingService } from './engine/encoder-vps-binding.service';
import { EngineIdentityService } from './engine/engine-identity.service';
import { EngineService } from './engine/engine.service';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
  ],
  controllers: [HealthController],
  providers: [
    EncoderVpsBindingService,
    EngineIdentityService,
    EngineService,
    BackendRegisterService,
  ],
})
export class AppModule {}
