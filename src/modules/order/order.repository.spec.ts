import {
  OrderRepository,
  ORDER_DETAIL_INCLUDE,
  calculateFiatAmount,
} from './order.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  ORDER_PARTY_SELECT,
  PAYMENT_METHOD_SELECT,
  PAYMENT_PROVIDER_SELECT,
} from '../../common/prisma-selects';

describe('OrderRepository', () => {
  describe('fiat total calculation', () => {
    it('uses decimal arithmetic for repeating fractional amounts', () => {
      expect(calculateFiatAmount('1.3333333', '3')).toBe('4.00');
    });

    it('rounds half up to two fiat decimal places', () => {
      expect(calculateFiatAmount('0.5', '0.01')).toBe('0.01');
    });
  });

  const order = {
    findMany: jest.fn().mockResolvedValue([]),
    findUnique: jest.fn().mockResolvedValue(null),
    groupBy: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  };

  const repo = new OrderRepository({ order } as unknown as PrismaService);

  beforeEach(() => {
    jest.clearAllMocks();
    order.findMany.mockResolvedValue([]);
    order.findUnique.mockResolvedValue(null);
    order.groupBy.mockResolvedValue([]);
  });

  describe('relation projections', () => {
    it('projects buyer and seller instead of loading full app_user rows', () => {
      expect(ORDER_DETAIL_INCLUDE.buyer).toEqual({
        select: ORDER_PARTY_SELECT,
      });
      expect(ORDER_DETAIL_INCLUDE.seller).toEqual({
        select: ORDER_PARTY_SELECT,
      });

      for (const field of [
        'kycStatus',
        'kycUpdatedAt',
        'notificationsEnabled',
        'pendingAccountInfo',
        'currentNonce',
        'email',
      ]) {
        expect(ORDER_PARTY_SELECT).not.toHaveProperty(field);
      }
    });

    it('projects the offer payment methods and their provider', () => {
      expect(ORDER_DETAIL_INCLUDE.offer.include.payment_methods).toEqual({
        select: PAYMENT_METHOD_SELECT,
      });
      expect(PAYMENT_METHOD_SELECT.payment_provider).toEqual({
        select: PAYMENT_PROVIDER_SELECT,
      });
      // Holder PII and audit timestamps never reach an order payload.
      expect(PAYMENT_METHOD_SELECT).not.toHaveProperty('identificationNumber');
      expect(PAYMENT_PROVIDER_SELECT).not.toHaveProperty('created_at');
      expect(PAYMENT_PROVIDER_SELECT).not.toHaveProperty('updated_at');
    });

    it('keeps the escrow relation whole for the cancel/expiration flows', () => {
      expect(ORDER_DETAIL_INCLUDE.escrow).toBe(true);
    });
  });

  describe('search', () => {
    it('reads the list with the projected include in a single query', async () => {
      await repo.search({ buyerId: 'buyer-1' }, 10, 5);

      expect(order.findMany).toHaveBeenCalledTimes(1);
      expect(order.findMany).toHaveBeenCalledWith({
        where: { buyerId: 'buyer-1' },
        skip: 10,
        take: 5,
        orderBy: { orderId: 'desc' },
        include: ORDER_DETAIL_INCLUDE,
      });
    });
  });

  describe('findById', () => {
    it('reads the detail with the projected include in a single query', async () => {
      await repo.findById('order-1');

      expect(order.findUnique).toHaveBeenCalledTimes(1);
      expect(order.findUnique).toHaveBeenCalledWith({
        where: { orderId: 'order-1' },
        include: ORDER_DETAIL_INCLUDE,
      });
    });
  });

  describe('getUserStats', () => {
    it('derives both counters from a single groupBy query', async () => {
      order.groupBy.mockResolvedValue([
        { orderStatus: 'created', _count: { _all: 2 } },
        { orderStatus: 'released', _count: { _all: 3 } },
        { orderStatus: 'cancelled', _count: { _all: 1 } },
      ]);

      const stats = await repo.getUserStats('user-1');

      expect(stats).toEqual({ totalOrders: 6, completedOrders: 3 });
      expect(order.groupBy).toHaveBeenCalledTimes(1);
      expect(order.count).not.toHaveBeenCalled();
      expect(order.groupBy).toHaveBeenCalledWith({
        by: ['orderStatus'],
        where: { OR: [{ buyerId: 'user-1' }, { sellerId: 'user-1' }] },
        _count: { _all: true },
      });
    });

    it('returns zeroed stats for a user with no orders', async () => {
      order.groupBy.mockResolvedValue([]);

      await expect(repo.getUserStats('user-1')).resolves.toEqual({
        totalOrders: 0,
        completedOrders: 0,
      });
    });
  });
});
