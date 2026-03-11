import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { RequestIdInterceptor } from './common/interceptors/request-id.interceptor';
import { ResponseTransformInterceptor } from './common/interceptors/response-transform.interceptor';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug', 'verbose'],
  });

  // Security
  app.use(helmet());

  // CORS
  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3001';
  app.enableCors({
    origin: frontendUrl,
    credentials: true,
  });

  // Global interceptors
  app.useGlobalInterceptors(
    new RequestIdInterceptor(),
    new ResponseTransformInterceptor(),
  );

  // Global exception filter
  app.useGlobalFilters(new GlobalExceptionFilter());

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  logger.log(`SercofiRH API running on port ${port}`);
  logger.log(`Environment: ${process.env.NODE_ENV ?? 'development'}`);
  logger.log(`CORS origin: ${frontendUrl}`);
}

void bootstrap();
