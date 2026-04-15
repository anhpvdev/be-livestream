import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LivestreamProfileService } from './livestream-profile.service';
import {
  AddProfileVideoDto,
  CreateLivestreamProfileDto,
  ReorderProfileVideosDto,
} from './dto/livestream-profile.dto';
import { LivestreamProfile } from './entities/livestream-profile.entity';

@ApiTags('Livestream Profile')
@Controller('livestream/profiles')
export class LivestreamProfileController {
  constructor(
    private readonly livestreamProfileService: LivestreamProfileService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Tạo livestream profile' })
  @ApiBody({ type: CreateLivestreamProfileDto })
  async createProfile(
    @Body() dto: CreateLivestreamProfileDto,
  ): Promise<LivestreamProfile> {
    return this.livestreamProfileService.createProfile(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Danh sách livestream profiles' })
  async listProfiles(): Promise<LivestreamProfile[]> {
    return this.livestreamProfileService.listProfiles();
  }

  @Get(':profileId')
  @ApiOperation({ summary: 'Chi tiết livestream profile' })
  async getProfile(
    @Param('profileId', ParseUUIDPipe) profileId: string,
  ): Promise<LivestreamProfile> {
    return this.livestreamProfileService.findById(profileId);
  }

  @Delete(':profileId')
  @ApiOperation({ summary: 'Xóa livestream profile' })
  async removeProfile(
    @Param('profileId', ParseUUIDPipe) profileId: string,
  ): Promise<void> {
    return this.livestreamProfileService.removeProfile(profileId);
  }

  @Post(':profileId/videos')
  @ApiOperation({ summary: 'Add video vào profile' })
  @ApiBody({ type: AddProfileVideoDto })
  async addProfileVideo(
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Body() dto: AddProfileVideoDto,
  ): Promise<LivestreamProfile> {
    return this.livestreamProfileService.addVideo(profileId, dto);
  }

  @Delete(':profileId/videos/:mediaId')
  @ApiOperation({ summary: 'Remove video khỏi profile' })
  async removeProfileVideo(
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
  ): Promise<LivestreamProfile> {
    return this.livestreamProfileService.removeVideo(profileId, mediaId);
  }

  @Patch(':profileId/videos/reorder')
  @ApiOperation({ summary: 'Đổi thứ tự playlist video trong profile' })
  @ApiBody({ type: ReorderProfileVideosDto })
  async reorderProfileVideos(
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Body() dto: ReorderProfileVideosDto,
  ): Promise<LivestreamProfile> {
    return this.livestreamProfileService.reorderVideos(profileId, dto);
  }
}
