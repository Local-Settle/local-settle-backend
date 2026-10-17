import { IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateChatMessageDto {
  @IsUUID()
  orderId: string;

  @IsUUID()
  senderId: string;

  @IsString()
  content: string;

  @IsOptional()
  @IsUUID()
  clientMessageId?: string;
}
