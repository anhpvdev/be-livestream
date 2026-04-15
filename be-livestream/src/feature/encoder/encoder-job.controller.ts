import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { EncoderService } from './encoder.service';
import { EncoderJob } from './entities/encoder-job.entity';

@ApiTags('Encoder')
@Controller('encoder/jobs')
export class EncoderJobController {
  constructor(private readonly encoderService: EncoderService) {}

  @Get()
  @ApiOperation({ summary: 'Lấy danh sách encoder jobs' })
  @ApiOkResponse({ description: 'List encoder jobs' })
  async listJobs(): Promise<EncoderJob[]> {
    return this.encoderService.listJobs();
  }

  @Delete(':livestreamId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Xóa encoder job theo livestreamId' })
  @ApiParam({ name: 'livestreamId', type: 'string', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Job deleted' })
  async deleteJob(
    @Param('livestreamId', ParseUUIDPipe) livestreamId: string,
  ): Promise<void> {
    await this.encoderService.deleteJob(livestreamId);
  }
}
