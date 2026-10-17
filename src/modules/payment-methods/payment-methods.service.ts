import { Injectable } from '@nestjs/common';
import { PaginationDto } from '../../common/pagination.dto';
import { CreatePaymentMethodDto } from './dto/create-payment-method.dto';
import { UpdatePaymentMethodDto } from './dto/update-payment-method.dto';
import { PaymentMethodsRepository } from './payment-methods.repository';
import { PaymentMethodValidatorService } from './payment-method-validator.service';
import { AppException, ErrorCode } from '../../common/errors';
import { PaymentMethod } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction, AuditResult } from '../audit-log/enums/audit-action.enum';
import { validatePaymentProviderMetadata } from '../payment-providers/payment-provider-metadata.validator';

@Injectable()
export class PaymentMethodsService {
  constructor(
    private readonly repo: PaymentMethodsRepository,
    private readonly prisma: PrismaService,
    private readonly validator: PaymentMethodValidatorService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async create(dto: CreatePaymentMethodDto): Promise<PaymentMethod> {
    const provider = await this.prisma.payment_provider.findUnique({
      where: { provider_id: dto.providerId },
    });

    if (!provider) {
      throw new AppException(
        ErrorCode.PAYMENT_PROVIDER_NOT_FOUND,
        'Payment provider not found',
      );
    }

    validatePaymentProviderMetadata(provider.type, provider.metadata);

    this.validator.validate(
      {
        type: provider.type,
        countryCode: provider.country_code,
        code: (provider.metadata as { code?: string } | null | undefined)?.code,
      },
      dto.accountIdentifier,
    );

    const created = (await this.repo.create({
      userId: dto.userId,
      providerId: dto.providerId,
      type: provider.type,
      accountIdentifier: dto.accountIdentifier,
      identificationNumber: dto.identificationNumber,
      beneficiaryName: dto.beneficiaryName,
      description: dto.description,
    })) as PaymentMethod;

    await this.auditLogService.create({
      userId: dto.userId,
      action: AuditAction.PAYMENT_METHOD_CREATED,
      resourceType: 'PaymentMethod',
      resourceId: created.paymentId,
      result: AuditResult.SUCCESS,
    });

    return created;
  }

  list(p: PaginationDto): Promise<PaymentMethod[]> {
    return this.repo.findMany({ skip: p.skip, take: p.take }) as Promise<
      PaymentMethod[]
    >;
  }

  async get(id: string): Promise<PaymentMethod> {
    const item = (await this.repo.findById(id)) as PaymentMethod;
    if (!item) {
      throw new AppException(
        ErrorCode.PAYMENT_METHOD_NOT_FOUND,
        `Payment method ${id} not found`,
      );
    }
    return item;
  }

  async update(
    id: string,
    dto: UpdatePaymentMethodDto,
  ): Promise<PaymentMethod> {
    const existing = (await this.repo.findById(id)) as PaymentMethod | null;
    if (!existing) {
      throw new AppException(
        ErrorCode.PAYMENT_METHOD_NOT_FOUND,
        `Payment method ${id} not found`,
      );
    }

    const providerId = dto.providerId ?? existing.providerId;
    const accountIdentifier =
      dto.accountIdentifier ?? existing.accountIdentifier;

    const provider = await this.prisma.payment_provider.findUnique({
      where: { provider_id: providerId },
    });

    if (!provider) {
      throw new AppException(
        ErrorCode.PAYMENT_PROVIDER_NOT_FOUND,
        'Payment provider not found',
      );
    }

    validatePaymentProviderMetadata(provider.type, provider.metadata);

    this.validator.validate(
      {
        type: provider.type,
        countryCode: provider.country_code,
        code: (provider.metadata as { code?: string } | null | undefined)?.code,
      },
      accountIdentifier,
    );

    const updated = (await this.repo.update(id, {
      providerId,
      type: provider.type,
      accountIdentifier,
      identificationNumber: dto.identificationNumber,
      beneficiaryName: dto.beneficiaryName,
      description: dto.description,
    })) as PaymentMethod;

    await this.auditLogService.create({
      userId: updated.userId,
      action: AuditAction.PAYMENT_METHOD_UPDATED,
      resourceType: 'PaymentMethod',
      resourceId: id,
      result: AuditResult.SUCCESS,
    });

    return updated;
  }

  async remove(id: string): Promise<PaymentMethod> {
    const removed = (await this.repo.delete(id)) as PaymentMethod;

    await this.auditLogService.create({
      userId: removed.userId,
      action: AuditAction.PAYMENT_METHOD_DELETED,
      resourceType: 'PaymentMethod',
      resourceId: id,
      result: AuditResult.SUCCESS,
    });

    return removed;
  }
}
