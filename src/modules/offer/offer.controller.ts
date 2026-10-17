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
import { SetupCompleteGuard } from '../auth/setup-complete.guard';
import { KycVerifiedGuard } from '../../common/kyc-verified.guard';

@Controller('offers')
export class OfferController {
  constructor(private readonly service: OfferService) {}

  @Post()
  @UseGuards(JwtAuthGuard, SetupCompleteGuard, KycVerifiedGuard)
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
  list(@Query() p: PaginationDto, @Query() q: OfferFilter) {
    return this.service.list(p, q);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, SetupCompleteGuard, KycVerifiedGuard)
  update(@Param('id') id: string, @Body() dto: UpdateOfferDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, SetupCompleteGuard, KycVerifiedGuard)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
