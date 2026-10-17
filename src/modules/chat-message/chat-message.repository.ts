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

  async markDelivered(orderId: string, recipientId: string) {
    const participants = await this.findOrderParticipants(orderId);
    if (
      !participants ||
      (participants.buyerId !== recipientId &&
        participants.sellerId !== recipientId)
    ) {
      return null;
    }
    const preference = await this.prisma.appUser.findUnique({
      where: { userId: recipientId },
      select: { messageReceiptsEnabled: true },
    });
    if (!preference?.messageReceiptsEnabled) return null;

    const messages = await this.prisma.chatMessage.findMany({
      where: { orderId, senderId: { not: recipientId }, deliveredAt: null },
      select: { messageId: true },
    });
    if (messages.length === 0) return null;

    const updatedAt = new Date();
    const messageIds = messages.map(({ messageId }) => messageId);
    await this.prisma.chatMessage.updateMany({
      where: { messageId: { in: messageIds }, orderId },
      data: { deliveredAt: updatedAt },
    });
    return { orderId, messageIds, state: 'delivered' as const, updatedAt };
  }

  async markRead(orderId: string, readerId: string) {
    const participants = await this.findOrderParticipants(orderId);
    if (
      !participants ||
      (participants.buyerId !== readerId && participants.sellerId !== readerId)
    ) {
      return null;
    }
    const preference = await this.prisma.appUser.findUnique({
      where: { userId: readerId },
      select: { messageReceiptsEnabled: true },
    });
    if (!preference?.messageReceiptsEnabled) return null;

    const messages = await this.prisma.chatMessage.findMany({
      where: { orderId, senderId: { not: readerId }, readAt: null },
      select: { messageId: true },
    });
    if (messages.length === 0) return null;

    const updatedAt = new Date();
    const messageIds = messages.map(({ messageId }) => messageId);
    await this.prisma.chatMessage.updateMany({
      where: { messageId: { in: messageIds }, orderId },
      data: { deliveredAt: updatedAt, readAt: updatedAt },
    });
    return { orderId, messageIds, state: 'read' as const, updatedAt };
  }
}
