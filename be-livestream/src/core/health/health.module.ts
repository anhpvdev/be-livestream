import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { EncoderModule } from '@/feature/encoder/encoder.module';
import { HealthController } from './health.controller';

@Module({
  imports: [TerminusModule, EncoderModule],
  controllers: [HealthController],
  providers: [],
})
export class HealthModule {}
