import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuditLogRepository } from './audit-log.repository';
import { CreateAuditLogInput } from './interfaces/create-audit-log.interface';

/**
 * Centralized audit logging service.
 *
 * Every critical action across the platform (auth, payment methods,
 * offers/orders, escrow, disputes, KYC, admin actions) should call
 * `create()` with a centralized `AuditAction` name rather than writing to
 * `AuditLog` directly, so every call site shares the same validation,
 * failure handling, and metadata-allowlisting discipline.
 *
 * ## Security notes
 *
 * `metadata` must be an explicitly-selected set of fields, never a raw
 * request body or full domain object. Never pass any of the following as
 * `metadata` (or any other field here):
 * - Wallet private keys
 * - JWT access tokens
 * - Webhook secrets
 * - Passwords
 * - Full bank account details
 * - Raw identity documents
 * - Unfiltered request bodies
 *
 * ## Failure handling
 *
 * `create()` never throws: a failed audit write is logged as a structured
 * application error (including the correlation id and action name) and
 * swallowed, so a logging failure alone cannot crash or 500 an otherwise
 * successful operation. For a small set of highly sensitive
 * administrative/financial operations where an unaudited action is
 * unacceptable, call sites should use `createOrThrow()` instead, which
 * propagates the failure so the caller can abort the operation.
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly repository: AuditLogRepository) {}

  /**
   * Write an audit record. Never throws — logging failures are recorded
   * via `Logger.error` (including `correlationId` and `action`) and
   * swallowed, so a broken audit sink cannot take down an otherwise
   * successful critical operation.
   */
  async create(input: CreateAuditLogInput): Promise<void> {
    try {
      await this.repository.create({
        ...input,
        ipAddress: this.maskIpAddress(input.ipAddress),
        userAgent: undefined,
      });
    } catch (error) {
      this.logger.error(
        `Failed to write audit log for action=${input.action} correlationId=${input.correlationId ?? 'none'}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Same as `create()`, but re-throws on failure. Use this at call sites
   * for highly sensitive administrative or financial operations where
   * proceeding without a persisted audit record is unacceptable — the
   * caller is expected to abort/roll back the operation on failure.
   */
  async createOrThrow(input: CreateAuditLogInput): Promise<void> {
    try {
      await this.repository.create({
        ...input,
        ipAddress: this.maskIpAddress(input.ipAddress),
        userAgent: undefined,
      });
    } catch (error) {
      this.logger.error(
        `Failed to write REQUIRED audit log for action=${input.action} correlationId=${input.correlationId ?? 'none'}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  findByUser(userId: string, skip = 0, take = 20) {
    return this.repository.findByUser(userId, skip, take);
  }

  findByResource(
    resourceType: string,
    resourceId: string,
    skip = 0,
    take = 20,
  ) {
    return this.repository.findByResource(resourceType, resourceId, skip, take);
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async pruneExpiredRecords(): Promise<void> {
    const configuredDays = Number(
      process.env.AUDIT_LOG_RETENTION_DAYS ?? '365',
    );
    const retentionDays =
      Number.isInteger(configuredDays) && configuredDays > 0
        ? configuredDays
        : 365;
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await this.repository.deleteCreatedBefore(cutoff);
    this.logger.log(`Pruned ${result.count} expired audit records`);
  }

  private maskIpAddress(ipAddress?: string): string | undefined {
    if (!ipAddress) return undefined;
    if (ipAddress.includes('.')) {
      const octets = ipAddress.split('.');
      return octets.length === 4 ? `${octets.slice(0, 3).join('.')}.0` : undefined;
    }
    if (ipAddress.includes(':'))
      return `${ipAddress.split(':').slice(0, 4).join(':')}::`;
    return undefined;
  }
}
