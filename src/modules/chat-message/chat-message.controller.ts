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
import { Request } from 'express';
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
  @UseGuards(JwtAuthGuard)
  list(
    @Query() p: PaginationDto,
    @Req() req: Request & { user: { userId: string } },
    @Query('orderId') orderId?: string,
  ) {
    return this.service.list(p, req.user.userId, orderId);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, ResourceOwnerGuard)
  @ResourceOwner(ResourceType.CHAT_MESSAGE)
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, ResourceOwnerGuard)
  @ResourceOwner(ResourceType.CHAT_MESSAGE)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
