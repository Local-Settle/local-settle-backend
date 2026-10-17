import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { PaginationDto } from '../../common/pagination.dto';
import { CreateChatMessageDto } from './dto/create-chat-message.dto';
import { ChatMessageService } from './chat-message.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ResourceOwnerGuard } from '../../common/guards/resource-owner.guard';
import { ResourceOwner } from '../../common/decorators/resource-owner.decorator';
import { ResourceType } from '../../common/interfaces/resource-owner.interface';

@Controller('chat-messages')
export class ChatMessageController {
  constructor(private readonly service: ChatMessageService) {}

  @Post()
  create(@Body() dto: CreateChatMessageDto) {
    return this.service.create(dto);
  }

  @Get()
  list(@Query() p: PaginationDto, @Query('orderId') orderId?: string) {
    return this.service.list(p, orderId);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, ResourceOwnerGuard)
  @ResourceOwner(ResourceType.CHAT_MESSAGE)
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Get(':id/attachments')
  @UseGuards(JwtAuthGuard)
  attachments(
    @Param('id') id: string,
    @Req() req: Request & { user: { userId: string } },
  ) {
    return this.service.getSignedAttachmentsForMessage(id, req.user.userId);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, ResourceOwnerGuard)
  @ResourceOwner(ResourceType.CHAT_MESSAGE)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
