import {
  IsOptional,
  IsArray,
  ArrayMaxSize,
  ArrayUnique,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class OrderRoomDto {
  @IsUUID()
  orderId: string;
}

export class SendMessageDto extends OrderRoomDto {
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  content?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  attachmentEvidenceIds?: string[];

  @IsOptional()
  @IsUUID()
  clientMessageId?: string;
}
