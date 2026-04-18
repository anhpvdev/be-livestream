import { Body, Controller, Get, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { EncoderVpsService } from './encoder-vps.service';
import { EncoderVpsListItemDto, UpdateEncoderVpsDto } from './dto/encoder-vps.dto';
import { EncoderVps } from './entities/encoder-vps.entity';

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
  async list(): Promise<EncoderVpsListItemDto[]> {
    return this.encoderVpsService.listWithUsage();
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
}
