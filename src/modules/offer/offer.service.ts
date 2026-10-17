import { Injectable } from '@nestjs/common';
import { PaginationDto } from '../../common/pagination.dto';
import { CreateOfferDto } from './dto/create-offer.dto';
import { UpdateOfferDto } from './dto/update-offer.dto';
import { OfferRepository } from './offer.repository';
import type { OfferWithRelations } from './offer.repository';
import { AppException, ErrorCode } from '../../common/errors';
import type { Offer, offer_status, offer_type } from '@prisma/client';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction, AuditResult } from '../audit-log/enums/audit-action.enum';

export type OfferFilter = {
  creatorId?: string;
  status?: offer_status;
  type?: offer_type;
  assetCode?: string;
  minPrice?: string;
  maxPrice?: string;
  minAmount?: string;
  maxAmount?: string;
  sortBy?: 'price' | 'createdAt' | 'offerId';
  sortOrder?: 'asc' | 'desc';
};

@Injectable()
export class OfferService {
  constructor(
    private readonly repo: OfferRepository,
    private readonly auditLogService: AuditLogService,
  ) {}

  async create(dto: CreateOfferDto): Promise<OfferWithRelations> {
    const created = await this.repo.create(
      dto as unknown as Record<string, unknown>,
    );

    await this.auditLogService.create({
      userId: created.creatorId,
      action: AuditAction.OFFER_CREATED,
      resourceType: 'Offer',
      resourceId: created.offerId,
      result: AuditResult.SUCCESS,
      metadata: { type: created.type, assetCode: created.assetCode },
    });

    return created;
  }

  list(p: PaginationDto, q: OfferFilter): Promise<OfferWithRelations[]> {
    const where: Record<string, unknown> = {};
    if (q.creatorId) where.creatorId = q.creatorId;
    if (q.status) where.status = q.status;
    if (q.type) where.type = q.type;
    if (q.assetCode) where.assetCode = q.assetCode;
    if (q.minPrice !== undefined || q.maxPrice !== undefined) {
      where.price = {
        ...(q.minPrice !== undefined ? { gte: q.minPrice } : {}),
        ...(q.maxPrice !== undefined ? { lte: q.maxPrice } : {}),
      };
    }
    if (q.minAmount !== undefined || q.maxAmount !== undefined) {
      where.AND = [
        ...(q.minAmount !== undefined ? [{ maxAmount: { gte: q.minAmount } }] : []),
        ...(q.maxAmount !== undefined ? [{ minAmount: { lte: q.maxAmount } }] : []),
      ];
    }
    const sortBy = q.sortBy === 'price' || q.sortBy === 'createdAt' ? q.sortBy : 'offerId';
    const sortOrder = q.sortOrder === 'asc' ? 'asc' : 'desc';
    return this.repo.search(where, p.skip, p.take, sortBy, sortOrder);
  }

  async get(id: string): Promise<OfferWithRelations> {
    const item = await this.repo.findById(id);
    if (!item) {
      throw new AppException(
        ErrorCode.OFFER_NOT_FOUND,
        `Offer ${id} not found`,
      );
    }
    return item;
  }

  async update(id: string, dto: UpdateOfferDto): Promise<Offer> {
    const updated = (await this.repo.update(
      id,
      dto as unknown as Record<string, unknown>,
    )) as Offer;

    await this.auditLogService.create({
      userId: updated.creatorId,
      action: AuditAction.OFFER_UPDATED,
      resourceType: 'Offer',
      resourceId: id,
      result: AuditResult.SUCCESS,
    });

    return updated;
  }

  async remove(id: string): Promise<Offer> {
    const removed = (await this.repo.delete(id)) as Offer;

    await this.auditLogService.create({
      userId: removed.creatorId,
      action: AuditAction.OFFER_CANCELLED,
      resourceType: 'Offer',
      resourceId: id,
      result: AuditResult.SUCCESS,
    });

    return removed;
  }
}
