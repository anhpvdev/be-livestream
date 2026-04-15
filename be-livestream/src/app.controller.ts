import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('System')
@Controller()
export class AppController {
  constructor() {}

  @Get('/hello')
  @ApiOperation({ summary: 'Simple health check endpoint' })
  @ApiResponse({ status: 200, description: 'Service is healthy', type: String })
  getHealth(): string {
    return 'Backend still okey :3';
  }
}
