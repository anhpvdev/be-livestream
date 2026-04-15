import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { addTransactionalDataSource } from 'typeorm-transactional';
import { AppEnv } from '../config/app-configs';
import { createDatabaseConfig } from './database.config';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppEnv>) =>
        createDatabaseConfig(configService),
      async dataSourceFactory(options) {
        if (!options) {
          throw new Error('Invalid database options');
        }

        const dataSource = new DataSource(options);
        await dataSource.initialize();
        return addTransactionalDataSource(dataSource);
      },
    }),
  ],
})
export class DatabaseModule {}
