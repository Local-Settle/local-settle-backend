import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../../common/base.repository';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class ChatMessageRepository extends BaseRepository {
  constructor(private readonly prisma: PrismaService) {
    super(prisma.chatMessage, 'messageId');
  }

  findByOrder(orderId: string, skip = 0, take = 50, cursor?: string) {
    return this.prisma.chatMessage.findMany({
      where: { orderId },
      skip: cursor ? 1 : skip,
      take,
      ...(cursor ? { cursor: { messageId: cursor } } : {}),
      orderBy: [{ timestamp: 'asc' }, { messageId: 'asc' }],
    });
  }

  findOrderParticipants(orderId: string) {
    return this.prisma.order.findUnique({
      where: { orderId },
      select: { buyerId: true, sellerId: true },
    });
  }

  async cursorBelongsToOrder(orderId: string, cursor: string): Promise<boolean> {
    return Boolean(await this.prisma.chatMessage.findFirst({
      where: { orderId, messageId: cursor },
      select: { messageId: true },
    }));
  }
}
