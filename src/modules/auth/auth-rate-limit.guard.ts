import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppException, ErrorCode } from '../../common/errors';
import { createHash } from 'crypto';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction, AuditResult } from '../audit-log/enums/audit-action.enum';

interface RateLimitWindow {
  count: number;
  windowStart: number;
}

/**
 * Lightweight in-memory fixed-window rate limiter for the authentication
 * endpoints, keyed by route + client IP. It blunts brute-force attempts
 * against the challenge-response flow without introducing an external
 * dependency or shared store.
 */
@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  static readonly WINDOW_MS = 60_000;
  static readonly MAX_ATTEMPTS = 10;

  private readonly windows = new Map<string, RateLimitWindow>();

  constructor(private readonly auditLogService: AuditLogService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const publicKey = (request.body as { publicKey?: unknown } | undefined)
      ?.publicKey;
    const wallet = typeof publicKey === 'string' ? publicKey : undefined;
    const ipAddress = request.ip ?? 'unknown';
    const keys = [
      `${request.path}:ip:${ipAddress}`,
      ...(wallet ? [`${request.path}:wallet:${wallet}`] : []),
    ];
    const windowMs = this.getPositiveInteger(
      'AUTH_CHALLENGE_RATE_LIMIT_TTL_MS',
      60_000,
    );
    const maxAttempts = this.getPositiveInteger(
      'AUTH_CHALLENGE_RATE_LIMIT_MAX',
      10,
    );

    const now = Date.now();
    this.pruneExpired(now, windowMs);
    const overLimitScope = keys.find((key) => {
      const window = this.windows.get(key);
      return Boolean(window && window.count >= maxAttempts);
    });
    if (overLimitScope) {
      await this.auditLogService.create({
        action: AuditAction.AUTH_RATE_LIMITED,
        resourceType: 'AuthChallenge',
        resourceId:
          !wallet
            ? undefined
            : createHash('sha256').update(wallet).digest('hex'),
        result: AuditResult.FAILURE,
        ipAddress,
        metadata: {
          operation: 'challenge',
          scope: overLimitScope.includes(':ip:') ? 'ip' : 'wallet',
        },
      });
      throw new AppException(
        ErrorCode.TOO_MANY_REQUESTS,
        'Too many challenge requests for this wallet and IP. Please retry after the rate-limit window.',
      );
    }
    for (const key of keys) {
      const window = this.windows.get(key);
      if (!window || now - window.windowStart >= windowMs) {
        this.windows.set(key, { count: 1, windowStart: now });
      } else {
        window.count += 1;
      }
    }
    return true;
  }

  reset(): void {
    this.windows.clear();
  }

  private pruneExpired(now: number, windowMs: number): void {
    for (const [key, window] of this.windows) {
      if (now - window.windowStart >= windowMs) {
        this.windows.delete(key);
      }
    }
  }

  private getPositiveInteger(name: string, fallback: number): number {
    const parsed = Number(process.env[name]);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
  }
}
