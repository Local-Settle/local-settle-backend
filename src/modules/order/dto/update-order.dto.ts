import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateOrderDto } from './create-order.dto';

// State changes belong to explicit order actions, never the generic PATCH route.
export class UpdateOrderDto extends PartialType(
  OmitType(CreateOrderDto, ['orderStatus'] as const),
) {}
