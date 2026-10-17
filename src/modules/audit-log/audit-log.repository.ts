import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateAuditLogInput } from './interfaces/create-audit-log.interface';

/**
 * Data-access layer for audit log records.
 *
 * Intentionally exposes only `create` and read methods â€” audit records are
 * immutable through normal application flows, so there is no `update` or
 * `delete` here. This does not extend `BaseRepository`, since that base
 * class exposes update/delete operations that audit logs must never allow.
 */
@Injectable()
export class AuditLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateAuditLogInput) {
    return this.prisma.auditLog.create({
      data: {
        userId: input.userId,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        result: input.result,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        correlationId: input.correlationId,
        metadata: input.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }

  findByUser(userId: string, skip = 0, take = 20) {
    return this.prisma.auditLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
  }

  findByResource(
    resourceType: string,
    resourceId: string,
    skip = 0,
    take = 20,
  ) {
    return this.prisma.auditLog.findMany({
      where: { resourceType, resourceId },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
  }

  deleteCreatedBefore(cutoff: Date) {
    return this.prisma.auditLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
  }
}
