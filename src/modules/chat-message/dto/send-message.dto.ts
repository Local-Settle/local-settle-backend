import {
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class OrderRoomDto {
  @IsUUID()
  orderId: string;
}

export class SendMessageDto extends OrderRoomDto {
  @IsString()
  content: string;

  @IsOptional()
  @IsUUID()
  clientMessageId?: string;
}
