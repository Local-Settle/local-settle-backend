import { Controller, Module, Post, Body, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { HttpExceptionFilter } from '../src/common/errors';
import {
  EVIDENCE_FILE_SIZE_LIMIT,
  JSON_BODY_LIMIT,
  MULTIPART_FIELD_LIMITS,
  URLENCODED_BODY_LIMIT,
} from '../src/common/request-limits';
import { requestSizeErrorHandler } from '../src/common/request-size-error-handler';

@Controller('limits-test')
class LimitsTestController {
  @Post('json')
  json(@Body() body: Record<string, unknown>) {
    return { accepted: true, keys: Object.keys(body).length };
  }

  @Post('evidence')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: EVIDENCE_FILE_SIZE_LIMIT,
        ...MULTIPART_FIELD_LIMITS,
      },
    }),
  )
  evidence(@UploadedFile() file?: { size: number }) {
    return { accepted: true, size: file?.size };
  }
}

@Module({ controllers: [LimitsTestController] })
class LimitsTestModule {}

describe('request size limits (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [LimitsTestModule],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>({
      bodyParser: false,
      rawBody: true,
    });
    app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
    app.useBodyParser('urlencoded', {
      extended: true,
      limit: URLENCODED_BODY_LIMIT,
      parameterLimit: 100,
    });
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    app.use(requestSizeErrorHandler);
  });

  afterAll(async () => {
    await app.close();
  });

  it('accepts JSON bodies within the configured limit', async () => {
    await request(app.getHttpServer())
      .post('/limits-test/json')
      .send({ ok: true })
      .expect(201)
      .expect({ accepted: true, keys: 1 });
  });

  it('returns a stable 413 response for oversized JSON', async () => {
    await request(app.getHttpServer())
      .post('/limits-test/json')
      .set('Content-Type', 'application/json')
      .send(`{"payload":"${'x'.repeat(1024 * 1024)}"}`)
      .expect(413)
      .expect({
        statusCode: 413,
        error: 'PAYLOAD_TOO_LARGE',
        message: 'Request payload is too large',
      });
  });

  it('accepts multipart evidence within the configured limits', async () => {
    await request(app.getHttpServer())
      .post('/limits-test/evidence')
      .attach('file', Buffer.from('evidence'), 'evidence.txt')
      .expect(201)
      .expect({ accepted: true, size: 8 });
  });

  it('returns a stable 413 response for oversized multipart fields', async () => {
    await request(app.getHttpServer())
      .post('/limits-test/evidence')
      .field('metadata', 'x'.repeat(MULTIPART_FIELD_LIMITS.fieldSize + 1))
      .expect(413)
      .expect({
        statusCode: 413,
        error: 'PAYLOAD_TOO_LARGE',
        message: 'Request payload is too large',
      });
  });
});
