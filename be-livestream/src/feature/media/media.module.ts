import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MediaFile } from './entities/media.entity';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { Livestream } from '../livestream/entities/livestream.entity';

@Module({
  imports: [TypeOrmModule.forFeature([MediaFile, Livestream])],
  controllers: [MediaController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
