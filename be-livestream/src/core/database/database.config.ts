import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { AppEnv } from '../config/app-configs';

export const createDatabaseConfig = (
  configService: ConfigService<AppEnv>,
): TypeOrmModuleOptions => ({
  type: 'postgres',
  host: configService.get<string>('POSTGRES_HOST'),
  port: configService.get<number>('POSTGRES_PORT'),
  username: configService.get<string>('POSTGRES_USER'),
  password: configService.get<string>('POSTGRES_PASSWORD'),
  database: configService.get<string>('POSTGRES_DB'),
  autoLoadEntities: true,
  synchronize: configService.get<string>('DB_SYNCHRONIZE') === 'true',
  logging: configService.get<string>('DB_LOGGING') === 'true',
});
