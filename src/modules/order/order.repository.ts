import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../../common/base.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import { Order, Prisma } from '@prisma/client';
import {
  ORDER_PARTY_SELECT,
  PAYMENT_METHOD_SELECT,
} from '../../common/prisma-selects';
import { ORDER_STATUS } from './order.constants';

export const ORDER_DETAIL_INCLUDE = {
  offer: {
    include: {
      payment_methods: { select: PAYMENT_METHOD_SELECT },
    },
  },
  escrow: true,
  buyer: { select: ORDER_PARTY_SELECT },
  seller: { select: ORDER_PARTY_SELECT },
} satisfies Prisma.OrderInclude;

export type OrderWithRelations = Prisma.OrderGetPayload<{
  include: typeof ORDER_DETAIL_INCLUDE;
}>;

const SCALE = 10_000_000n;

function toScaled(value: string | number): bigint {
  const text = String(value);
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new Error('Order amounts and offer prices must be decimal values.');
  const fraction = match[2] ?? '';
  let scaled = BigInt(match[1]) * SCALE + BigInt(fraction.slice(0, 7).padEnd(7, '0') || '0');
  if (fraction.length > 7 && fraction[7] >= '5') scaled += 1n;
  return scaled;
}

/** Multiplies 7-place asset values and rounds fiat totals to 2 places, half up. */
export function calculateFiatAmount(assetAmount: string | number, price: string | number): string {
  const product = toScaled(assetAmount) * toScaled(price);
  const cents = (product + 500_000_000_000n) / 1_000_000_000_000n;
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}

@Injectable()
export class OrderRepository extends BaseRepository {
  constructor(private readonly prisma: PrismaService) {
    super(prisma.order, 'orderId');
  }

  // Override create to atomically create order+escrow and mark the offer as executed.
  // Accepts an optional pre-generated orderId so the same UUID can be used as the
  // Trustless Work engagementId before any DB record is persisted.
  async create(data: {
    orderId?: string; // optional pre-generated UUID
    offerId: string;
    buyerId: string;
    sellerId: string;
    assetAmount: string | number;
    fiatAmount?: string | number;
    orderStatus?: string;
    expiresAt?: Date | string | null;
    // Escrow data to persist alongside the order
    escrow?: {
      contractId: string;
      sellerAddress: string;
      buyerAddress: string;
      amount: string | number;
    };
  }): Promise<Order & { escrowId: string | null }> {
    const created = await this.prisma.$transaction(async (tx) => {
      const offer = await tx.offer.findUnique({
        where: { offerId: data.offerId },
        select: { price: true },
      });
      if (!offer) throw new Error(`Offer ${data.offerId} not found.`);
      const fiatAmount = calculateFiatAmount(data.assetAmount, String(offer.price));
      const payload = {
        ...(data.orderId ? { orderId: data.orderId } : {}),
        offerId: data.offerId,
        buyerId: data.buyerId,
        sellerId: data.sellerId,
        assetAmount: data.assetAmount,
        fiatAmount,
        orderStatus: data.orderStatus || undefined,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
      } as Prisma.OrderUncheckedCreateInput;

      const order = await tx.order.create({ data: payload });

      // Persist escrow record atomically with the order if data is provided
      let escrowId: string | null = null;
      if (data.escrow) {
        const escrow = await tx.escrowOnChain.create({
          data: {
            orderId: order.orderId,
            contractId: data.escrow.contractId,
            sellerAddress: data.escrow.sellerAddress,
            buyerAddress: data.escrow.buyerAddress,
            amount: data.escrow.amount,
            escrowStatus: 'initialized',
          },
        });
        escrowId = escrow.escrowId;
      }

      // Mark the offer as executed so it no longer appears in the active market
      await tx.offer.update({
        where: { offerId: data.offerId },
        data: { executed: true },
      });
      return { ...order, escrowId };
    });

    return created;
  }

  search(
    where: Record<string, unknown>,
    skip = 0,
    take = 20,
  ): Promise<OrderWithRelations[]> {
    return this.prisma.order.findMany({
      where,
      skip,
      take,
      orderBy: { orderId: 'desc' },
      include: ORDER_DETAIL_INCLUDE,
    });
  }

  findById(id: string): Promise<OrderWithRelations | null> {
    return this.prisma.order.findUnique({
      where: { orderId: id },
      include: ORDER_DETAIL_INCLUDE,
    });
  }

  async getUserStats(
    userId: string,
  ): Promise<{ totalOrders: number; completedOrders: number }> {
    const countsByStatus = await this.prisma.order.groupBy({
      by: ['orderStatus'],
      where: {
        OR: [{ buyerId: userId }, { sellerId: userId }],
      },
      _count: { _all: true },
    });

    return countsByStatus.reduce(
      (stats, row) => {
        const count = row._count._all;
        stats.totalOrders += count;
        if (row.orderStatus === ORDER_STATUS.RELEASED) {
          stats.completedOrders += count;
        }
        return stats;
      },
      { totalOrders: 0, completedOrders: 0 },
    );
  }
}
