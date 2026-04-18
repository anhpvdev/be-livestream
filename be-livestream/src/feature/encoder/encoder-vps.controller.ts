import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import {
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { EncoderVpsService } from './encoder-vps.service';
import { EncoderVpsListItemDto, UpdateEncoderVpsDto } from './dto/encoder-vps.dto';
import { EncoderVps } from './entities/encoder-vps.entity';
import { ListEncoderVpsQueryDto } from './dto/list-encoder-vps-query.dto';

@ApiTags('Encoder VPS')
@Controller('encoder/vps')
export class EncoderVpsController {
  constructor(private readonly encoderVpsService: EncoderVpsService) {}

  @Get()
  @ApiOperation({
    summary: 'Danh sách VPS encoder',
    description:
      'Trả về mọi VPS đã đăng ký; isFree = không đang gán cho livestream LIVE/TESTING.',
  })
  @ApiOkResponse({ type: [EncoderVpsListItemDto] })
  async list(@Query() query: ListEncoderVpsQueryDto): Promise<EncoderVpsListItemDto[]> {
    return this.encoderVpsService.listWithUsage(query);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Admin: cập nhật VPS encoder' })
  @ApiOkResponse({ type: EncoderVps })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEncoderVpsDto,
  ): Promise<EncoderVps> {
    return this.encoderVpsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Admin: xóa VPS encoder' })
  @ApiNoContentResponse({ description: 'Encoder VPS deleted' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.encoderVpsService.remove(id);
  }
}
