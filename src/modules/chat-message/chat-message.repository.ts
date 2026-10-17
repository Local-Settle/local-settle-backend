import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../../common/base.repository';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class ChatMessageRepository extends BaseRepository {
  constructor(private readonly prisma: PrismaService) {
    super(prisma.chatMessage, 'messageId');
  }

  findByOrder(orderId: string, skip = 0, take = 50) {
    return this.prisma.chatMessage.findMany({
      where: { orderId },
      skip,
      take,
      orderBy: { timestamp: 'asc' },
    });
  }

  findOrderParticipants(orderId: string) {
    return this.prisma.order.findUnique({
      where: { orderId },
      select: { buyerId: true, sellerId: true },
    });
  }

  findEvidenceForOrder(orderId: string, evidenceIds: string[]) {
    return this.prisma.escrowOnChain.findMany({
      where: {
        orderId,
        escrowId: { in: evidenceIds },
        evidenceUrl: { not: null },
      },
      select: {
        escrowId: true,
        evidenceUrl: true,
        evidenceFileName: true,
        evidenceContentType: true,
        evidenceSize: true,
      },
    });
  }

  findMessageOrderAndAttachmentRefs(messageId: string) {
    return this.prisma.chatMessage.findUnique({
      where: { messageId },
      select: { orderId: true, attachmentRefs: true },
    });
  }
}
