import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../../common/base.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

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

  async createIdempotent(data: {
    orderId: string;
    senderId: string;
    content: string;
    clientMessageId?: string;
  }) {
    if (!data.clientMessageId) return this.create(data as Record<string, unknown>);
    return this.prisma.chatMessage.upsert({
      where: {
        orderId_senderId_clientMessageId: {
          orderId: data.orderId,
          senderId: data.senderId,
          clientMessageId: data.clientMessageId,
        },
      } as Prisma.ChatMessageWhereUniqueInput,
      create: data,
      update: {},
    });
  }
}
