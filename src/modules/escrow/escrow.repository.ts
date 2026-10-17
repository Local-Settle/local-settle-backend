import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../../common/base.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import { EscrowOnChain } from '@prisma/client';

@Injectable()
export class EscrowRepository extends BaseRepository {
  constructor(private readonly prisma: PrismaService) {
    super(prisma.escrowOnChain, 'escrowId');
  }

  findByOrder(orderId: string): Promise<EscrowOnChain | null> {
    return this.prisma.escrowOnChain.findUnique({ where: { orderId } });
  }

  findExpiredEvidence(before: Date) {
    return this.prisma.escrowOnChain.findMany({
      where: {
        evidenceUrl: { not: null },
        evidenceUploadedAt: { lte: before },
        order: {
          is: { orderStatus: { in: ['released', 'cancelled', 'expired'] } },
        },
      },
      select: { escrowId: true, evidenceUrl: true },
    });
  }
}
