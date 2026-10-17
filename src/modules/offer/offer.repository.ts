import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../../common/base.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { PAYMENT_METHOD_SELECT } from '../../common/prisma-selects';
import { PaymentDataCipher } from '../payment-methods/payment-data-cipher';

export const OFFER_DETAIL_INCLUDE = {
  payment_methods: { select: PAYMENT_METHOD_SELECT },
} satisfies Prisma.OfferInclude;

export type OfferWithRelations = Prisma.OfferGetPayload<{
  include: typeof OFFER_DETAIL_INCLUDE;
}>;

@Injectable()
export class OfferRepository extends BaseRepository {
  private readonly paymentDataCipher = new PaymentDataCipher();

  constructor(private readonly prisma: PrismaService) {
    super(prisma.offer, 'offerId');
  }

  async create(data: Record<string, unknown>): Promise<OfferWithRelations> {
    const { paymentMethodIds, ...offerData } = data as {
      paymentMethodIds?: string[];
      [key: string]: unknown;
    };

    const connectPaymentMethods: { connect?: Array<{ paymentId: string }> } =
      {};

    if (paymentMethodIds && paymentMethodIds.length > 0) {
      const v2Methods = await this.prisma.paymentMethod.findMany({
        where: { paymentId: { in: paymentMethodIds } },
        select: { paymentId: true },
      });
      if (v2Methods.length > 0) {
        connectPaymentMethods.connect = v2Methods.map(
          (m: { paymentId: string }) => ({
            paymentId: m.paymentId,
          }),
        );
      }
    }

    const created = await this.prisma.offer.create({
      data: {
        ...offerData,
        payment_methods: connectPaymentMethods.connect
          ? connectPaymentMethods
          : undefined,
      } as never,
      include: OFFER_DETAIL_INCLUDE,
    });
    return this.decryptPaymentMethods(created);
  }

  async findById(offerId: string): Promise<OfferWithRelations | null> {
    const offer = await this.prisma.offer.findUnique({
      where: { offerId },
      include: OFFER_DETAIL_INCLUDE,
    });
    return offer ? this.decryptPaymentMethods(offer) : null;
  }

  search(
    where: Record<string, unknown>,
    skip = 0,
    take = 20,
  ): Promise<OfferWithRelations[]> {
    return this.prisma.offer.findMany({
      where,
      skip,
      take,
      orderBy: { offerId: 'desc' },
      include: OFFER_DETAIL_INCLUDE,
    }).then((offers) => offers.map((offer) => this.decryptPaymentMethods(offer)));
  }

  private decryptPaymentMethods<T extends { payment_methods?: unknown[] }>(offer: T): T {
    if (!Array.isArray(offer.payment_methods)) return offer;
    return {
      ...offer,
      payment_methods: offer.payment_methods.map((method) =>
        this.paymentDataCipher.decryptFields(method as never),
      ),
    };
  }
}
