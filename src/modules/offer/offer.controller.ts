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
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AppException, ErrorCode } from '../../common/errors';
import { PaginationDto } from '../../common/pagination.dto';
import { CreateOfferDto } from './dto/create-offer.dto';
import { UpdateOfferDto } from './dto/update-offer.dto';
import { OfferService, type OfferFilter } from './offer.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { KycVerifiedGuard } from '../../common/kyc-verified.guard';
import { BadRequestException } from '@nestjs/common';

@Controller('offers')
export class OfferController {
  constructor(private readonly service: OfferService) {}

  @Post()
  @UseGuards(JwtAuthGuard, KycVerifiedGuard)
  create(
    @Body() dto: CreateOfferDto,
    @Req() req: Request & { user: { userId: string } },
  ) {
    if (dto.creatorId !== req.user.userId) {
      throw new AppException(
        ErrorCode.UNAUTHORIZED_ACTION,
        'You can only create offers for yourself',
      );
    }
    return this.service.create(dto);
  }

  @Get()
  list(
    @Query() p: PaginationDto,
    @Query() q: OfferFilter,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
    @Query('minAmount') minAmount?: string,
    @Query('maxAmount') maxAmount?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
  ) {
    for (const value of [minPrice, maxPrice, minAmount, maxAmount]) {
      if (value !== undefined && (!/^\d+(\.\d+)?$/.test(value) || !Number.isFinite(Number(value)))) {
        throw new BadRequestException('Price and amount filters must be non-negative numbers');
      }
    }
    if (sortBy && !['price', 'createdAt', 'offerId'].includes(sortBy)) {
      throw new BadRequestException('sortBy must be price, createdAt, or offerId');
    }
    if (sortOrder && !['asc', 'desc'].includes(sortOrder)) {
      throw new BadRequestException('sortOrder must be asc or desc');
    }
    q.minPrice = minPrice;
    q.maxPrice = maxPrice;
    q.minAmount = minAmount;
    q.maxAmount = maxAmount;
    q.sortBy = (sortBy as OfferFilter['sortBy']) ?? 'offerId';
    q.sortOrder = sortOrder === 'asc' ? 'asc' : 'desc';
    return this.service.list(p, q);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, KycVerifiedGuard)
  update(@Param('id') id: string, @Body() dto: UpdateOfferDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, KycVerifiedGuard)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
