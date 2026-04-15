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
} from '@nestjs/common';
import {
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { LivestreamService } from './livestream.service';
import { StartLivestreamDto } from './dto/start-livestream.dto';
import {
  LivestreamResponseDto,
  StartLivestreamAckDto,
  LivestreamStatusResponseDto,
} from './dto/livestream-response.dto';

@ApiTags('Livestream')
@Controller('livestream')
export class LivestreamController {
  constructor(private readonly livestreamService: LivestreamService) {}

  @Post('start/preflight')
  @ApiOperation({ summary: 'Preflight check trước khi start livestream thật' })
  @ApiBody({ type: StartLivestreamDto })
  async preflight(@Body() dto: StartLivestreamDto) {
    return this.livestreamService.preflightStart(dto);
  }

  @Post('start')
  @ApiOperation({ summary: 'Start a new livestream' })
  @ApiBody({ type: StartLivestreamDto })
  @ApiOkResponse({ type: StartLivestreamAckDto })
  async start(@Body() dto: StartLivestreamDto): Promise<StartLivestreamAckDto> {
    return this.livestreamService.startLivestream(dto);
  }

  @Post(':id/stop')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stop a running livestream' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiOkResponse({ type: LivestreamResponseDto })
  async stop(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LivestreamResponseDto> {
    const ls = await this.livestreamService.stopLivestream(id);
    return this.livestreamService.toResponse(ls);
  }

  @Get(':id/status')
  @ApiOperation({ summary: 'Get livestream status with progress' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiOkResponse({ type: LivestreamStatusResponseDto })
  async getStatus(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LivestreamStatusResponseDto> {
    return this.livestreamService.getStatus(id);
  }

  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resume a failed/stopped livestream from last timestamp',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiOkResponse({ type: LivestreamResponseDto })
  async resume(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LivestreamResponseDto> {
    const ls = await this.livestreamService.resumeLivestream(id);
    return this.livestreamService.toResponse(ls);
  }

  @Get()
  @ApiOperation({ summary: 'List all livestreams' })
  @ApiOkResponse({ type: [LivestreamResponseDto] })
  async findAll(): Promise<LivestreamResponseDto[]> {
    const list = await this.livestreamService.findAll();
    return list.map((ls) => this.livestreamService.toResponse(ls));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a livestream' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.livestreamService.removeLivestream(id);
  }
}
