import { Module } from '@nestjs/common';
import { ChatMessageController } from './chat-message.controller';
import { ChatMessageRepository } from './chat-message.repository';
import { ChatMessageService } from './chat-message.service';
import { AuthModule } from '../auth/auth.module';
import { ChatMessageGateway } from './chat-message.gateway';
import { FileStorageModule } from '../file-storage/file-storage.module';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
  imports: [AuthModule, FileStorageModule, AuditLogModule],
  controllers: [ChatMessageController],
  providers: [ChatMessageService, ChatMessageRepository, ChatMessageGateway],
  exports: [ChatMessageService],
})
export class ChatMessageModule {}
