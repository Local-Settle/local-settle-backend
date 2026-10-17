import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../../common/base.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { PAYMENT_METHOD_SELECT } from '../../common/prisma-selects';

export const OFFER_DETAIL_INCLUDE = {
  payment_methods: { select: PAYMENT_METHOD_SELECT },
} satisfies Prisma.OfferInclude;

export type OfferWithRelations = Prisma.OfferGetPayload<{
  include: typeof OFFER_DETAIL_INCLUDE;
}>;

@Injectable()
export class OfferRepository extends BaseRepository {
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

    return this.prisma.offer.create({
      data: {
        ...offerData,
        payment_methods: connectPaymentMethods.connect
          ? connectPaymentMethods
          : undefined,
      } as never,
      include: OFFER_DETAIL_INCLUDE,
    });
  }

  findById(offerId: string): Promise<OfferWithRelations | null> {
    return this.prisma.offer.findUnique({
      where: { offerId },
      include: OFFER_DETAIL_INCLUDE,
    });
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
    });
  }

  async searchPage(where: Record<string, unknown>, skip = 0, take = 20) {
    const [items, total] = await Promise.all([
      this.search(where, skip, take),
      this.prisma.offer.count({ where: where as Prisma.OfferWhereInput }),
    ]);
    const hasMore = skip + items.length < total;
    return {
      items,
      total,
      skip,
      take,
      hasMore,
      nextSkip: hasMore ? skip + items.length : null,
    };
  }
}
