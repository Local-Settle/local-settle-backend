import 'dotenv/config';
import type { Request, Response, NextFunction } from 'express';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/errors';
import { parseCookies } from './common/guards/csrf.guard';
import { apiVersionMiddleware } from './common/api-version.middleware';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  app.use(helmet());
  app.use(apiVersionMiddleware);
  app.useGlobalFilters(new HttpExceptionFilter());

  app.use(
    (
      req: Request & { cookies?: Record<string, string> },
      _res: Response,
      next: NextFunction,
    ) => {
      if (!req.cookies && typeof req.headers?.cookie === 'string') {
        req.cookies = parseCookies(req.headers.cookie);
      }
      next();
    },
  );

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.enableCors({
    origin: [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:3001',
      'http://127.0.0.1:3001',
      'https://ikash-frontend-dev-977686155876.us-central1.run.app',
      'https://ikash.it.com',
    ],
    credentials: true,
    exposedHeaders: ['X-API-Version', 'Deprecation', 'Sunset', 'Link'],
  });

  // Configure proxy trust for rate-limiting client IP extraction
  const trustProxy = process.env.TRUST_PROXY || '1';
  app
    .getHttpAdapter()
    .getInstance()
    .set(
      'trust proxy',
      isNaN(Number(trustProxy)) ? trustProxy : Number(trustProxy),
    );

  // 👇 CORRECCIÓN AQUÍ: Agrega '0.0.0.0' como segundo parámetro
  const port = process.env.PORT ?? 3001;
  await app.listen(port, '0.0.0.0');

  console.log(`Application is running on port ${port}`);
}
void bootstrap();
