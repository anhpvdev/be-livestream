import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

const resolvePort = (): number => {
  const argv = process.argv;
  const idx = argv.findIndex((x) => x === '--port' || x === '-p');
  const fromArg =
    idx >= 0 && argv[idx + 1] ? Number(argv[idx + 1]) : Number.NaN;
  if (Number.isInteger(fromArg) && fromArg > 0) {
    return fromArg;
  }

  const fromEnv = process.env.PORT ? Number(process.env.PORT) : Number.NaN;
  if (Number.isInteger(fromEnv) && fromEnv > 0) {
    return fromEnv;
  }

  return 8080;
};

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidUnknownValues: false,
    }),
  );

  const port = resolvePort();
  await app.listen(port);
}

void bootstrap();
