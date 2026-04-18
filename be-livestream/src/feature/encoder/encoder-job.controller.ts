import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Query,
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
import { ListEncoderJobQueryDto } from './dto/list-encoder-job-query.dto';

@ApiTags('Encoder')
@Controller('encoder/jobs')
export class EncoderJobController {
  constructor(private readonly encoderService: EncoderService) {}

  @Get()
  @ApiOperation({ summary: 'Lấy danh sách encoder jobs' })
  @ApiOkResponse({ description: 'List encoder jobs' })
  async listJobs(@Query() query: ListEncoderJobQueryDto): Promise<EncoderJob[]> {
    return this.encoderService.listJobs(query.desiredState);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Xóa toàn bộ encoder jobs' })
  @ApiNoContentResponse({ description: 'All jobs deleted' })
  async deleteAllJobs(): Promise<void> {
    await this.encoderService.deleteAllJobs();
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
