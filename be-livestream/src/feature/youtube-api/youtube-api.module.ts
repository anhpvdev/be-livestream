import { Module } from '@nestjs/common';
import { GoogleAccountModule } from '../google-account/google-account.module';
import { YouTubeApiService } from './youtube-api.service';
import { YouTubeLivestreamOrchestratorService } from './youtube-livestream-orchestrator.service';

@Module({
  imports: [GoogleAccountModule],
  providers: [YouTubeApiService, YouTubeLivestreamOrchestratorService],
  exports: [YouTubeApiService, YouTubeLivestreamOrchestratorService],
})
export class YouTubeApiModule {}
