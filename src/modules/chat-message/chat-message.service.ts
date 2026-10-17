import { Injectable } from '@nestjs/common';
import { PaginationDto } from '../../common/pagination.dto';
import { CreateChatMessageDto } from './dto/create-chat-message.dto';
import { ChatMessageRepository } from './chat-message.repository';
import { AppException, ErrorCode } from '../../common/errors';
import { ChatMessage } from '@prisma/client';
import { validateChatMessageContent } from './chat-message-content';

@Injectable()
export class ChatMessageService {
  constructor(private readonly repo: ChatMessageRepository) {}

  create(dto: CreateChatMessageDto): Promise<ChatMessage> {
    const validation = validateChatMessageContent(dto.content);
    if (!validation.valid) {
      const messages = {
        empty: 'Message cannot be empty.',
        too_long: 'Message exceeds the 4000 character limit.',
        control_character: 'Message contains unsupported control characters.',
        not_string: 'Message must be text.',
      };
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        messages[validation.reason],
      );
    }
    return this.repo.create(
      { ...dto, content: validation.content } as unknown as Record<string, unknown>,
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
    if (orderId) return this.repo.findByOrder(orderId, p.skip, p.take ?? 50);
    return this.repo.findMany({
      skip: p.skip,
      take: p.take ?? 50,
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
