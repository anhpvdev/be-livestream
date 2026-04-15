import {
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { EncoderMonitorService } from './encoder-monitor.service';

@ApiTags('Encoder')
@Controller('encoder')
export class EncoderMonitorController {
  constructor(private readonly encoderMonitorService: EncoderMonitorService) {}

  @Get('monitor/current')
  @ApiOperation({ summary: 'Lấy snapshot realtime CPU và RAM từ encoder-monitor' })
  @ApiOkResponse({ description: 'Encoder monitor current metrics' })
  async getMonitorCurrentMetrics(): Promise<unknown> {
    return this.encoderMonitorService.getCurrentMetrics();
  }

  @Get('monitor')
  @ApiOperation({
    summary: 'Lấy thống kê min/max/avg CPU và RAM từ encoder-monitor',
  })
  @ApiQuery({ name: 'minutes', required: false, type: Number, example: 5 })
  @ApiOkResponse({ description: 'Encoder monitor metrics summary' })
  async getMonitorMetrics(
    @Query('minutes', new DefaultValuePipe(5), ParseIntPipe) minutes: number,
  ): Promise<unknown> {
    const windowMinutes = minutes > 0 ? minutes : 5;
    return this.encoderMonitorService.getMetrics(windowMinutes);
  }
}
