import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { CoreModule } from './core/core.module';
import { validateAppEnv } from './core/config/app-configs';
import { FeatureModule } from './feature/feature.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateAppEnv,
    }),
    ScheduleModule.forRoot(),
    CoreModule,
    FeatureModule,
  ],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}
