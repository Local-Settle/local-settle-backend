import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  Req,
  Logger,
  Get,
  Query,
  type RawBodyRequest,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { rateLimitConfig } from '../../config/rate-limit.config';
import type { Request } from 'express';
import { KycService } from './kyc.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AppException, ErrorCode } from '../../common/errors';
import { CsrfExempt } from '../../common/decorators/csrf-exempt.decorator';

@Controller('kyc')
export class KycController {
  private readonly logger = new Logger(KycController.name);

  constructor(
    private readonly kycService: KycService,
    private readonly prisma: PrismaService,
  ) {}

  @Throttle({ default: rateLimitConfig.kycStart })
  @Post('start')
  async startKyc(@Body('userId') userId: string) {
    if (!userId) {
      throw new AppException(ErrorCode.MISSING_USER_ID, 'User ID is required');
    }
    return this.kycService.initializeSession(userId);
  }

  /**
   * Lightweight polling endpoint — frontend calls this after returning from
   * Didit to get the latest kycStatus without waiting for the webhook.
   */
  @Get('status')
  async getKycStatus(@Query('userId') userId: string) {
    if (!userId) {
      throw new AppException(ErrorCode.MISSING_USER_ID, 'User ID is required');
    }
    const user = await this.prisma.appUser.findUnique({
      where: { userId, deletedAt: null },
      select: { kycStatus: true, kycUpdatedAt: true },
    });
    if (!user) {
      return { kycStatus: 'pending', kycUpdatedAt: null };
    }
    return user;
  }

  @Throttle({ default: rateLimitConfig.kycWebhook })
  @CsrfExempt()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Headers('x-signature-v2') signatureV2: string,
    @Headers('x-signature') signatureV1: string,
    @Headers('x-signature-simple') signatureSimple: string,
    @Headers('x-timestamp') timestamp: string,
    @Req() req: RawBodyRequest<Request>,
    @Body() payload: Record<string, unknown>,
  ) {
    this.logger.log(
      `[WEBHOOK] Received webhook. Headers: x-signature-v2=${!!signatureV2}, x-signature=${!!signatureV1}, x-signature-simple=${!!signatureSimple}`,
    );

    this.kycService.verifyWebhookSignature({
      signatureV2,
      signatureV1,
      signatureSimple,
      timestamp,
      rawBody: req.rawBody,
      payload,
    });

    await this.kycService.processWebhookEvent(payload);

    return { received: true };
  }
}
