import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { MediaService } from './media.service';
import { MediaResponseDto } from './dto/media-response.dto';
import { UploadMediaDto } from './dto/upload-media.dto';
import { ListMediaQueryDto } from './dto/list-media-query.dto';

@ApiTags('Media')
@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('upload')
  @ApiOperation({ summary: 'Upload media file với name + type' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadMediaDto })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const allowed = /^(video|audio|image)\//;
        if (!allowed.test(file.mimetype)) {
          cb(new Error('Only video/audio/image files are allowed'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  async upload(
    @Body() dto: UploadMediaDto,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<MediaResponseDto> {
    const media = await this.mediaService.upload(file, dto);
    return this.toResponse(media);
  }

  @Get()
  @ApiOperation({ summary: 'List all media files' })
  @ApiOkResponse({ type: [MediaResponseDto] })
  async findAll(@Query() query: ListMediaQueryDto): Promise<MediaResponseDto[]> {
    const list = await this.mediaService.findAll(query);
    return list.map((m) => this.toResponse(m));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get media file info' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiOkResponse({ type: MediaResponseDto })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MediaResponseDto> {
    const media = await this.mediaService.findById(id);
    return this.toResponse(media);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a media file' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.mediaService.remove(id);
  }

  private toResponse(media: any): MediaResponseDto {
    return {
      id: media.id,
      name: media.name,
      originalName: media.originalName,
      storageKey: media.storageKey,
      mimeType: media.mimeType,
      type: media.kind,
      sizeBytes: media.sizeBytes,
      durationSeconds: media.durationSeconds,
      resolution: media.resolution,
      codec: media.codec,
      status: media.status,
      createdAt: media.createdAt,
    };
  }
}
