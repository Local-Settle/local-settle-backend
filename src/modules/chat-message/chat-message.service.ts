import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
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

  async canAccessOrder(
    orderId: string,
    userId: string,
  ): Promise<boolean | null> {
    const order = await this.repo.findOrderParticipants(orderId);
    if (!order) return null;
    return order.buyerId === userId || order.sellerId === userId;
  }

  list(p: PaginationDto, orderId?: string): Promise<ChatMessage[]> {
    if (orderId) return this.listOrderHistory(orderId, p);
    return this.repo.findMany({
      skip: p.skip,
      take: p.take ?? 50,
      orderBy: { timestamp: 'desc' },
    }) as Promise<ChatMessage[]>;
  }

  async listOrderHistory(orderId: string, p: PaginationDto): Promise<ChatMessage[]> {
    if (p.cursor && !(await this.repo.cursorBelongsToOrder(orderId, p.cursor))) {
      throw new BadRequestException('Cursor must identify a message in this order');
    }
    return this.repo.findByOrder(orderId, p.skip, Math.min(p.take ?? 50, 100), p.cursor);
  }

  async assertOrderAccess(orderId: string, userId: string): Promise<void> {
    const allowed = await this.canAccessOrder(orderId, userId);
    if (allowed === null) throw new NotFoundException('Order not found');
    if (!allowed) throw new ForbiddenException('Only order participants can read chat history');
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
