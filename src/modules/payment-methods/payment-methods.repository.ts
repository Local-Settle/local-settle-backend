import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { BaseRepository, FindManyArgs } from '../../common/base.repository';
import { PaymentDataCipher } from './payment-data-cipher';
import { PaymentMethod } from '@prisma/client';

@Injectable()
export class PaymentMethodsRepository extends BaseRepository {
  private readonly cipher = new PaymentDataCipher();

  constructor(private readonly prisma: PrismaService) {
    super(prisma.paymentMethod, 'paymentId');
  }

  override async create(data: Record<string, unknown>): Promise<PaymentMethod> {
    const encrypted = await super.create(this.cipher.encryptFields(data as {
      accountIdentifier?: string;
      identificationNumber?: string | null;
      beneficiaryName?: string | null;
    })) as PaymentMethod;
    return this.cipher.decryptFields(encrypted) as PaymentMethod;
  }

  override async findById(id: string): Promise<PaymentMethod | null> {
    const row = await super.findById(id) as PaymentMethod | null;
    return row ? this.decodeAndMigrate(row) : null;
  }

  override async findMany(args: FindManyArgs = {}): Promise<PaymentMethod[]> {
    const rows = await super.findMany(args) as PaymentMethod[];
    return Promise.all(rows.map((row) => this.decodeAndMigrate(row)));
  }

  override async update(id: string, data: Record<string, unknown>): Promise<PaymentMethod> {
    const encrypted = await super.update(id, this.cipher.encryptFields(data as {
      accountIdentifier?: string;
      identificationNumber?: string | null;
      beneficiaryName?: string | null;
    })) as PaymentMethod;
    return this.cipher.decryptFields(encrypted) as PaymentMethod;
  }

  override async delete(id: string): Promise<PaymentMethod> {
    const row = await super.delete(id) as PaymentMethod;
    return this.cipher.decryptFields(row) as PaymentMethod;
  }

  private async decodeAndMigrate(row: PaymentMethod): Promise<PaymentMethod> {
    const decrypted = this.cipher.decryptFields(row) as PaymentMethod;
    const migrated = this.cipher.encryptFields(decrypted) as PaymentMethod;
    const currentVersion = process.env.PAYMENT_DATA_ENCRYPTION_CURRENT_VERSION ?? 'v1';
    const fields = ['accountIdentifier', 'identificationNumber', 'beneficiaryName'] as const;
    const legacy = fields.some((field) =>
      typeof row[field] === 'string' &&
        (!row[field]!.startsWith('enc:') || !row[field]!.startsWith(`enc:${currentVersion}:`)),
    );
    if (legacy) {
      await this.prisma.paymentMethod.update({
        where: { paymentId: row.paymentId },
        data: Object.fromEntries(fields.map((field) => [field, migrated[field]])),
      });
    }
    return decrypted;
  }
}
