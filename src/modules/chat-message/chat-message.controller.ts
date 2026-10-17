import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PaginationDto } from '../../common/pagination.dto';
import { CreateChatMessageDto } from './dto/create-chat-message.dto';
import { ChatMessageService } from './chat-message.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SetupCompleteGuard } from '../auth/setup-complete.guard';
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
  @UseGuards(JwtAuthGuard, SetupCompleteGuard, ResourceOwnerGuard)
  @ResourceOwner(ResourceType.CHAT_MESSAGE)
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, SetupCompleteGuard, ResourceOwnerGuard)
  @ResourceOwner(ResourceType.CHAT_MESSAGE)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
