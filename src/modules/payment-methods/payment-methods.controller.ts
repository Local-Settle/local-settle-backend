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
import { CreatePaymentMethodDto } from './dto/create-payment-method.dto';
import { UpdatePaymentMethodDto } from './dto/update-payment-method.dto';
import { PaymentMethodsService } from './payment-methods.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SetupCompleteGuard } from '../auth/setup-complete.guard';
import { ResourceOwnerGuard } from '../../common/guards/resource-owner.guard';
import { ResourceOwner } from '../../common/decorators/resource-owner.decorator';
import { ResourceType } from '../../common/interfaces/resource-owner.interface';

@Controller('payment-methods')
export class PaymentMethodsController {
  constructor(private readonly service: PaymentMethodsService) {}

  @Post()
  create(@Body() dto: CreatePaymentMethodDto) {
    return this.service.create(dto);
  }

  @Get()
  list(@Query() p: PaginationDto) {
    return this.service.list(p);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, SetupCompleteGuard, ResourceOwnerGuard)
  @ResourceOwner(ResourceType.PAYMENT_METHOD)
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, SetupCompleteGuard, ResourceOwnerGuard)
  @ResourceOwner(ResourceType.PAYMENT_METHOD)
  update(@Param('id') id: string, @Body() dto: UpdatePaymentMethodDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, SetupCompleteGuard, ResourceOwnerGuard)
  @ResourceOwner(ResourceType.PAYMENT_METHOD)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
