import { Body, Controller, Get, Post } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { EngineService } from './engine/engine.service';

class ProbeMediaDto {
  @IsString()
  @MinLength(1)
  mediaPath!: string;
}

@Controller()
export class HealthController {
  constructor(private readonly engineService: EngineService) {}

  @Get('health')
  getHealth() {
    return this.engineService.getHealth();
  }

  @Post('stop')
  async stop() {
    await this.engineService.requestStop();
    return { ok: true };
  }

  @Post('probe-media')
  async probeMedia(@Body() dto: ProbeMediaDto) {
    const result = await this.engineService.probeMediaPath(dto.mediaPath);
    return { ...this.engineService.getHealth(), ...result };
  }
}
