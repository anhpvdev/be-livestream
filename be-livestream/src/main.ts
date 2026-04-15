import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  initializeTransactionalContext,
  StorageDriver,
} from 'typeorm-transactional';
import { AppModule } from './app.module';
import { AppEnv } from './core/config/app-configs';

const logger = new Logger('Bootstrap');

async function bootstrap() {
  initializeTransactionalContext({ storageDriver: StorageDriver.AUTO });

  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService<AppEnv>);
  const globalPrefix = configService.get<string>('API_PREFIX');
  const corsOriginsRaw = configService.get<string>('CORS_ORIGINS');
  const swaggerEnabled =
    configService.get<string>('SWAGGER_ENABLED') === 'true';
  const corsOrigins = corsOriginsRaw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const appName = configService.get<string>('APP_NAME');
  const appPort = configService.get<number>('PORT');
  const swaggerPath = `${globalPrefix}/docs`;
  const healthPath = `${globalPrefix}/health`;

  app.setGlobalPrefix(globalPrefix);
  app.enableCors({
    origin:
      corsOrigins.length === 1 && corsOrigins[0] === '*' ? true : corsOrigins,
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  if (swaggerEnabled) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle(appName)
        .setDescription(
          'Automation Livestream Backend - YouTube Live Streaming with FFmpeg Encoder Failover',
        )
        .setVersion('1.0.0')
        .addBearerAuth()
        .build(),
    );

    SwaggerModule.setup(swaggerPath, app, document);
  }

  await app.listen(appPort);
  logger.log(`Server listening on http://localhost:${appPort}/${globalPrefix}`);
  logger.log(`Health endpoint: http://localhost:${appPort}/${healthPath}`);

  if (swaggerEnabled) {
    logger.log(`Swagger endpoint: http://localhost:${appPort}/${swaggerPath}`);
  }
}

void bootstrap();
