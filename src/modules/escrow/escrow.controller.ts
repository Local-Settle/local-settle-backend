import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PaginationDto } from '../../common/pagination.dto';
import { CreateEscrowDto } from './dto/create-escrow.dto';
import { UpdateEscrowDto } from './dto/update-escrow.dto';
import { OpenEscrowDto } from './dto/open-escrow.dto';
import { InitializeEscrowDto } from './dto/initialize-escrow.dto';
import { FundEscrowDto } from './dto/fund-escrow.dto';
import type { UploadFileInput } from '../file-storage/file-storage.service';
import { FiatSentDto } from './dto/fiat-sent.dto';
import { ReleaseEscrowDto } from './dto/release-escrow.dto';
import { SyncEscrowDto } from './dto/sync-escrow.dto';
import { EscrowService } from './escrow.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ResourceOwnerGuard } from '../../common/guards/resource-owner.guard';
import { ResourceOwner } from '../../common/decorators/resource-owner.decorator';
import { ResourceType } from '../../common/interfaces/resource-owner.interface';

@Controller('escrows')
export class EscrowController {
  constructor(private readonly service: EscrowService) {}

  // ─── Trustless Work Escrow Flow ──────────────────────────────────────

  /**
   * Combined initialize+fund: backend deploys the escrow, returns
   * a single unsigned fund XDR for the user to sign once.
   * Call this when an order is confirmed.
   */
  @Post('open')
  @UseGuards(JwtAuthGuard, ResourceOwnerGuard)
  @ResourceOwner(ResourceType.ORDER, 'orderId')
  open(@Body() dto: OpenEscrowDto) {
    return this.service.open(dto);
  }

  /** Get unsigned XDR to deploy a new escrow contract (advanced / manual use) */
  @Post('initialize')
  @UseGuards(JwtAuthGuard, ResourceOwnerGuard)
  @ResourceOwner(ResourceType.ORDER, 'orderId')
  initialize(@Body() dto: InitializeEscrowDto) {
    return this.service.initialize(dto);
  }

  /** Get unsigned XDR to fund an existing escrow */
  @Post('fund')
  @UseGuards(JwtAuthGuard, ResourceOwnerGuard)
  @ResourceOwner(ResourceType.ESCROW, 'escrowId')
  fund(@Body() dto: FundEscrowDto) {
    return this.service.fund(dto);
  }

  /** Get unsigned XDR to release escrow funds */
  @Post('release')
  @UseGuards(JwtAuthGuard, ResourceOwnerGuard)
  @ResourceOwner(ResourceType.ESCROW, 'escrowId')
  release(@Body() dto: ReleaseEscrowDto) {
    return this.service.release(dto);
  }

  /** Submit signed XDR and update DB status */
  @Post('sync')
  @UseGuards(JwtAuthGuard, ResourceOwnerGuard)
  @ResourceOwner(ResourceType.ESCROW, 'escrowId')
  sync(@Body() dto: SyncEscrowDto) {
    return this.service.syncTransaction(dto);
  }

  /** Mark that the buyer has sent fiat payment */
  @Post(':id/fiat-sent')
  @UseGuards(JwtAuthGuard, ResourceOwnerGuard)
  @ResourceOwner(ResourceType.ESCROW)
  markFiatSent(@Param('id') id: string, @Body() dto: FiatSentDto) {
    return this.service.markFiatSent(id, dto);
  }

  /** Upload evidence file (receipt) for an escrow */
  @Post(':id/evidence')
  @UseGuards(JwtAuthGuard, ResourceOwnerGuard)
  @ResourceOwner(ResourceType.ESCROW)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  uploadEvidence(
    @Param('id') id: string,
    @UploadedFile() file?: UploadFileInput,
  ) {
    return this.service.uploadEvidence(id, file);
  }

  /** Get escrow status with live on-chain data */
  @Get(':id/status')
  @UseGuards(JwtAuthGuard, ResourceOwnerGuard)
  @ResourceOwner(ResourceType.ESCROW)
  getStatus(@Param('id') id: string) {
    return this.service.getStatus(id);
  }

  // ─── Legacy CRUD ─────────────────────────────────────────────────────

  @Post()
  create(@Body() dto: CreateEscrowDto) {
    return this.service.create(dto);
  }

  @Get()
  list(@Query() p: PaginationDto, @Query('orderId') orderId?: string) {
    return this.service.list(p, orderId);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, ResourceOwnerGuard)
  @ResourceOwner(ResourceType.ESCROW)
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, ResourceOwnerGuard)
  @ResourceOwner(ResourceType.ESCROW)
  update(@Param('id') id: string, @Body() dto: UpdateEscrowDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, ResourceOwnerGuard)
  @ResourceOwner(ResourceType.ESCROW)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
