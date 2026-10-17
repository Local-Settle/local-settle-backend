import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import * as crypto from 'crypto';
import { Throttle } from '@nestjs/throttler';
import { rateLimitConfig } from '../../config/rate-limit.config';
import { AuthService } from './auth.service';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CreateAuthChallengeDto } from './dto/create-auth-challenge.dto';
import { LoginDto } from './dto/login.dto';
import {
  CSRF_COOKIE_NAME,
  getCsrfCookieOptions,
} from '../../config/cookie.config';
import { parseCookies } from '../../common/guards/csrf.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Generates a double-submit CSRF token, sets it in a SameSite cookie,
   * and returns the token value to the client.
   */
  @Get('csrf')
  getCsrfToken(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const rawCookies =
      (req.cookies as Record<string, string> | undefined) ||
      parseCookies(
        typeof req.headers?.cookie === 'string'
          ? req.headers.cookie
          : undefined,
      );
    const existingToken = rawCookies[CSRF_COOKIE_NAME];
    const isValidToken =
      typeof existingToken === 'string' &&
      /^[a-f0-9]{64}$/i.test(existingToken.trim());
    const token = isValidToken
      ? existingToken.trim()
      : crypto.randomBytes(32).toString('hex');
    res.cookie(CSRF_COOKIE_NAME, token, getCsrfCookieOptions());
    return { csrfToken: token };
  }

  /**
   * Step 1: issues a short-lived random challenge that the client must sign
   * with the wallet's secret key to prove ownership of the public key.
   */
  @Post('challenge')
  @UseGuards(AuthRateLimitGuard)
  createChallenge(@Body() dto: CreateAuthChallengeDto) {
    return this.authService.createChallenge(dto);
  }

  /**
   * Step 2: verifies the signed challenge and emits a temporary JWT only
   * after the signature proves ownership of the wallet. Passes request
   * context (IP, user agent) through for audit logging.
   */
  @Throttle({ default: rateLimitConfig.auth })
  @Post('login')
  @UseGuards(AuthRateLimitGuard)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    const ctx = {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    };
    return this.authService.login(dto, ctx);
  }

  /** Revokes this bearer token without affecting the user's other sessions. */
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  logout(
    @Req()
    req: Request & {
      user: { userId: string; sessionId?: string };
    },
  ) {
    return this.authService.revokeSession(req.user.userId, req.user.sessionId);
  }
}
