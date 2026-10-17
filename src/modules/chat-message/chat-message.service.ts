import { Injectable } from '@nestjs/common';
import { PaginationDto } from '../../common/pagination.dto';
import { CreateChatMessageDto } from './dto/create-chat-message.dto';
import { ChatMessageRepository } from './chat-message.repository';
import { AppException, ErrorCode } from '../../common/errors';
import { ChatMessage } from '@prisma/client';

@Injectable()
export class ChatMessageService {
  constructor(private readonly repo: ChatMessageRepository) {}

  create(dto: CreateChatMessageDto): Promise<ChatMessage> {
    return this.repo.create(
      dto as unknown as Record<string, unknown>,
    ) as Promise<ChatMessage>;
  }

  markDelivered(orderId: string, recipientId: string) {
    return this.repo.markDelivered(orderId, recipientId);
  }

  markRead(orderId: string, readerId: string) {
    return this.repo.markRead(orderId, readerId);
  }

  async canAccessOrder(
    orderId: string,
    userId: string,
  ): Promise<boolean | null> {
    const order = await this.repo.findOrderParticipants(orderId);
    if (!order) return null;
    return order.buyerId === userId || order.sellerId === userId;
  }

  async list(
    p: PaginationDto,
    userId: string,
    orderId?: string,
  ): Promise<ChatMessage[]> {
    if (orderId) {
      const canAccess = await this.canAccessOrder(orderId, userId);
      if (!canAccess) {
        throw new AppException(
          ErrorCode.UNAUTHORIZED_ACTION,
          'Only order participants can view its chat.',
        );
      }
      return this.repo.findByOrder(orderId, p.skip, p.take ?? 50);
    }
    return this.repo.findMany({
      skip: p.skip,
      take: p.take ?? 50,
      where: { order: { OR: [{ buyerId: userId }, { sellerId: userId }] } },
      orderBy: { timestamp: 'desc' },
    }) as Promise<ChatMessage[]>;
  }

  async get(id: string): Promise<ChatMessage> {
    const item = (await this.repo.findById(id)) as ChatMessage;
    if (!item) {
      throw new AppException(
        ErrorCode.CHAT_MESSAGE_NOT_FOUND,
        `Chat message ${id} not found`,
      );
    }
    return item;
  }

  remove(id: string): Promise<ChatMessage> {
    return this.repo.delete(id) as Promise<ChatMessage>;
  }
}
