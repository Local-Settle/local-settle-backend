import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PaginationDto } from '../../common/pagination.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { OrderService } from './order.service';
import type { OrderFilter } from './order.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SetupCompleteGuard } from '../auth/setup-complete.guard';
import { KycVerifiedGuard } from '../../common/kyc-verified.guard';
import { ResourceOwnerGuard } from '../../common/guards/resource-owner.guard';
import { ResourceOwner } from '../../common/decorators/resource-owner.decorator';
import { ResourceType } from '../../common/interfaces/resource-owner.interface';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AppException, ErrorCode } from '../../common/errors';

@Controller('orders')
export class OrderController {
  constructor(private readonly service: OrderService) {}

  @Post()
  @UseGuards(JwtAuthGuard, SetupCompleteGuard, KycVerifiedGuard)
  create(@Body() dto: CreateOrderDto, @CurrentUser() user: { userId: string }) {
    if (dto.buyerId !== user.userId && dto.sellerId !== user.userId) {
      throw new AppException(
        ErrorCode.UNAUTHORIZED_ACTION,
        'You can only create an order where you are the buyer or the seller',
      );
    }
    return this.service.create(dto);
  }

  @Get()
  list(@Query() p: PaginationDto, @Query() q: OrderFilter) {
    return this.service.list(p, q);
  }

  @Get('user-stats/:userId')
  getUserStats(@Param('userId') userId: string) {
    return this.service.getUserStats(userId);
  }

  // Intentionally guarded with JwtAuthGuard only, not KycVerifiedGuard:
  // cancelling an order the user is already in does not move new funds,
  // so it must not be blocked behind KYC completion.
  @Post(':id/cancel')
  @UseGuards(JwtAuthGuard, SetupCompleteGuard)
  cancel(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string; publicKey: string },
  ) {
    return this.service.cancel(id, user.userId);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, SetupCompleteGuard, ResourceOwnerGuard)
  @ResourceOwner(ResourceType.ORDER)
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Patch(':id')
  @UseGuards(
    JwtAuthGuard,
    SetupCompleteGuard,
    KycVerifiedGuard,
    ResourceOwnerGuard,
  )
  @ResourceOwner(ResourceType.ORDER)
  update(@Param('id') id: string, @Body() dto: UpdateOrderDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(
    JwtAuthGuard,
    SetupCompleteGuard,
    KycVerifiedGuard,
    ResourceOwnerGuard,
  )
  @ResourceOwner(ResourceType.ORDER)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
