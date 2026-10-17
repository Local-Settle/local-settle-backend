import { ConflictException, Injectable } from '@nestjs/common';
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
    fiatAmount: string | number;
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
      const payload = {
        ...(data.orderId ? { orderId: data.orderId } : {}),
        offerId: data.offerId,
        buyerId: data.buyerId,
        sellerId: data.sellerId,
        assetAmount: data.assetAmount,
        fiatAmount: data.fiatAmount,
        orderStatus: data.orderStatus || undefined,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
      } as Prisma.OrderUncheckedCreateInput;

      // Serialize capacity checks for a given offer. Without the row lock two
      // concurrent buyers can both observe the same remaining amount.
      const [offer] = await tx.$queryRaw<
        Array<{ max_amount: Prisma.Decimal; min_amount: Prisma.Decimal }>
      >`SELECT max_amount, min_amount FROM offer WHERE offer_id = ${data.offerId}::uuid FOR UPDATE`;

      if (!offer) {
        throw new ConflictException(`Offer ${data.offerId} is unavailable`);
      }

      const requestedAmount = new Prisma.Decimal(data.assetAmount);
      const minAmount = new Prisma.Decimal(offer.min_amount);
      const maxAmount = new Prisma.Decimal(offer.max_amount);
      const now = new Date();
      const reserved = await tx.order.aggregate({
        where: {
          offerId: data.offerId,
          orderStatus: { in: ['created', 'locked', 'disputed'] },
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        _sum: { assetAmount: true },
      });
      const usedAmount = reserved._sum.assetAmount ?? new Prisma.Decimal(0);
      const remaining = maxAmount.minus(usedAmount);

      if (
        requestedAmount.lessThan(minAmount) ||
        requestedAmount.greaterThan(remaining)
      ) {
        throw new ConflictException(
          `Order amount must be at least ${minAmount.toString()} and no more than the remaining offer amount ${remaining.toString()}`,
        );
      }

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

      // Keep an offer available while it still has reservable capacity.
      const totalReserved = usedAmount.plus(requestedAmount);
      await tx.offer.update({
        where: { offerId: data.offerId },
        data: { executed: totalReserved.greaterThanOrEqualTo(maxAmount) },
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
