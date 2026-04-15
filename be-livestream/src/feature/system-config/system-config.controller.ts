import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SystemConfigService } from './system-config.service';
import { SystemConfig } from './entities/system-config.entity';

class SetConfigDto {
  value: Record<string, unknown>;
}

@ApiTags('System Config')
@Controller('system-config')
export class SystemConfigController {
  constructor(private readonly systemConfigService: SystemConfigService) {}

  @Get()
  @ApiOperation({ summary: 'List all system config entries' })
  async list(): Promise<SystemConfig[]> {
    return this.systemConfigService.listAll();
  }

  @Get(':key')
  @ApiOperation({ summary: 'Get one config by key' })
  async getOne(@Param('key') key: string): Promise<SystemConfig | null> {
    return this.systemConfigService.getByKey(key);
  }

  @Put(':key')
  @ApiOperation({ summary: 'Upsert config value (JSON object)' })
  @ApiBody({ schema: { example: { value: { v: 28800 } } } })
  async put(
    @Param('key') key: string,
    @Body() body: SetConfigDto,
  ): Promise<SystemConfig> {
    return this.systemConfigService.setByKey(key, body.value ?? {});
  }
}
