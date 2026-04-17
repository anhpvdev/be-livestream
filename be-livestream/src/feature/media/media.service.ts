import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { MediaFile, MediaFileStatus } from './entities/media.entity';
import {
  Livestream,
  LivestreamStatus,
} from '../livestream/entities/livestream.entity';
import { UploadMediaDto } from './dto/upload-media.dto';

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    @InjectRepository(MediaFile)
    private readonly mediaRepo: Repository<MediaFile>,
    @InjectRepository(Livestream)
    private readonly livestreamRepo: Repository<Livestream>,
  ) {}

  async upload(
    file: Express.Multer.File,
    dto: UploadMediaDto,
  ): Promise<MediaFile> {
    const mediaId = randomUUID();
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storageKey = `media/${mediaId}/${sanitizedName}`;

    const media = this.mediaRepo.create({
      id: mediaId,
      name: dto.name.trim(),
      originalName: file.originalname,
      storageKey,
      mimeType: file.mimetype,
      kind: dto.type,
      sizeBytes: file.size,
      status: MediaFileStatus.UPLOADING,
    });
    await this.mediaRepo.save(media);

    try {
      await this.persistToSharedVolume(storageKey, file.buffer);

      const metadata = await this.extractMetadata(
        file.buffer,
        file.originalname,
      );
      media.durationSeconds = metadata.durationSeconds;
      media.resolution = metadata.resolution;
      media.codec = metadata.codec;
      media.status = MediaFileStatus.READY;

      await this.mediaRepo.save(media);
      this.logger.log(`Media uploaded: ${storageKey}`);
    } catch (err) {
      media.status = MediaFileStatus.ERROR;
      await this.mediaRepo.save(media);
      this.logger.error(`Media upload failed: ${err.message}`);
      throw err;
    }

    return media;
  }

  async findAll(): Promise<MediaFile[]> {
    return this.mediaRepo.find({
      order: {
        kind: 'ASC',
        name: 'ASC',
        createdAt: 'DESC',
      },
    });
  }

  async findById(id: string): Promise<MediaFile> {
    const media = await this.mediaRepo.findOne({ where: { id } });
    if (!media) {
      throw new NotFoundException(`Media file ${id} not found`);
    }
    return media;
  }

  async remove(id: string): Promise<void> {
    const media = await this.findById(id);

    const activeMain = await this.livestreamRepo.count({
      where: {
        mediaFileId: id,
        status: In([LivestreamStatus.LIVE, LivestreamStatus.TESTING]),
      },
    });
    if (activeMain > 0) {
      throw new ConflictException(
        'Không thể xóa media đang gắn với livestream đang LIVE/TESTING',
      );
    }

    try {
      await this.deleteFromSharedVolume(media.storageKey);
      if (media.thumbnailKey) {
        await this.deleteFromSharedVolume(media.thumbnailKey);
      }
    } catch (err) {
      this.logger.warn(`Failed to delete storage object: ${err.message}`);
    }
    await this.mediaRepo.remove(media);
  }

  async assertRtmpCopyCompatible(id: string): Promise<void> {
    const media = await this.findById(id);
    const fullPath = join(process.cwd(), 'media', media.storageKey);

    const probe = await new Promise<{
      videoCodec: string | null;
      audioCodec: string | null;
    }>((resolve, reject) => {
      try {
        const ffmpeg = require('fluent-ffmpeg');
        ffmpeg.ffprobe(fullPath, (err: Error, data: any) => {
          if (err) {
            reject(err);
            return;
          }
          const videoStream = data.streams?.find(
            (s: any) => s.codec_type === 'video',
          );
          const audioStream = data.streams?.find(
            (s: any) => s.codec_type === 'audio',
          );
          resolve({
            videoCodec: videoStream?.codec_name || null,
            audioCodec: audioStream?.codec_name || null,
          });
        });
      } catch (error) {
        reject(error);
      }
    });

    if (probe.videoCodec !== 'h264') {
      throw new BadRequestException(
        `Media ${id} không tương thích stream copy: video codec phải là h264 (hiện tại: ${probe.videoCodec ?? 'none'})`,
      );
    }

    if (!probe.audioCodec || !['aac', 'mp3'].includes(probe.audioCodec)) {
      throw new BadRequestException(
        `Media ${id} không tương thích stream copy: audio codec phải là aac/mp3 (hiện tại: ${probe.audioCodec ?? 'none'})`,
      );
    }
  }

  async getMediaBuffer(id: string): Promise<Buffer> {
    const media = await this.findById(id);
    const fullPath = join(process.cwd(), 'media', media.storageKey);
    return readFile(fullPath);
  }

  private async extractMetadata(
    buffer: Buffer,
    filename: string,
  ): Promise<{
    durationSeconds: number | null;
    resolution: string | null;
    codec: string | null;
  }> {
    return new Promise((resolve) => {
      try {
        const ffmpeg = require('fluent-ffmpeg');
        const { Readable } = require('stream');
        const stream = Readable.from(buffer);

        ffmpeg(stream).ffprobe((err: Error, data: any) => {
          if (err) {
            this.logger.warn(`ffprobe failed for ${filename}: ${err.message}`);
            resolve({ durationSeconds: null, resolution: null, codec: null });
            return;
          }

          const videoStream = data.streams?.find(
            (s: any) => s.codec_type === 'video',
          );

          const rawDuration = data.format?.duration;
          const parsedDuration =
            typeof rawDuration === 'number'
              ? rawDuration
              : typeof rawDuration === 'string'
                ? Number(rawDuration)
                : NaN;
          const durationSeconds = Number.isFinite(parsedDuration)
            ? parsedDuration
            : null;

          resolve({
            durationSeconds,
            resolution: videoStream
              ? `${videoStream.width}x${videoStream.height}`
              : null,
            codec: videoStream?.codec_name || null,
          });
        });
      } catch {
        resolve({ durationSeconds: null, resolution: null, codec: null });
      }
    });
  }

  private async persistToSharedVolume(
    storageKey: string,
    data: Buffer,
  ): Promise<void> {
    const fullPath = join(process.cwd(), 'media', storageKey);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, data);
  }

  private async deleteFromSharedVolume(storageKey: string): Promise<void> {
    const fullPath = join(process.cwd(), 'media', storageKey);
    await rm(fullPath, { force: true });
  }
}
