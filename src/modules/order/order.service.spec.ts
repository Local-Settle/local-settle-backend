jest.mock('@stellar/stellar-sdk', () => ({}));

import { Test, TestingModule } from '@nestjs/testing';
import { OrderService } from './order.service';
import { OrderRepository } from './order.repository';
import { EscrowService } from '../escrow/escrow.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('OrderService.cancel', () => {
  let service: OrderService;
  let repo: {
    findById: jest.Mock;
    update: jest.Mock;
  };

  const baseOrder = {
    orderId: 'order-1',
    buyerId: 'buyer-1',
    sellerId: 'seller-1',
    orderStatus: 'created',
    escrow: null as { escrowStatus: string } | null,
  };

  beforeEach(async () => {
    repo = {
      findById: jest.fn(),
      update: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderService,
        { provide: OrderRepository, useValue: repo },
        { provide: EscrowService, useValue: {} },
        { provide: AuditLogService, useValue: { create: jest.fn() } },
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();

    service = module.get(OrderService);
  });

  it('cancels an order with no escrow yet', async () => {
    repo.findById.mockResolvedValue({ ...baseOrder });
    repo.update.mockResolvedValue({ ...baseOrder, orderStatus: 'cancelled' });

    await expect(service.cancel('order-1', 'buyer-1')).resolves.toEqual(
      expect.objectContaining({ orderStatus: 'cancelled' }),
    );
    expect(repo.update).toHaveBeenCalledWith('order-1', {
      orderStatus: 'cancelled',
    });
  });

  it('cancels an order whose escrow is only pending', async () => {
    repo.findById.mockResolvedValue({
      ...baseOrder,
      escrow: { escrowStatus: 'pending' },
    });
    repo.update.mockResolvedValue({ ...baseOrder, orderStatus: 'cancelled' });

    await expect(service.cancel('order-1', 'seller-1')).resolves.toBeDefined();
    expect(repo.update).toHaveBeenCalled();
  });

  it('cancels an order whose escrow is initialized but not funded', async () => {
    repo.findById.mockResolvedValue({
      ...baseOrder,
      escrow: { escrowStatus: 'initialized' },
    });
    repo.update.mockResolvedValue({ ...baseOrder, orderStatus: 'cancelled' });

    await expect(service.cancel('order-1', 'buyer-1')).resolves.toBeDefined();
    expect(repo.update).toHaveBeenCalled();
  });

  it('rejects cancellation from an unrelated user', async () => {
    repo.findById.mockResolvedValue({ ...baseOrder });

    await expect(service.cancel('order-1', 'stranger-1')).rejects.toThrow();
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('rejects cancellation when the order does not exist', async () => {
    repo.findById.mockResolvedValue(null);

    await expect(service.cancel('missing-order', 'buyer-1')).rejects.toThrow();
    expect(repo.update).not.toHaveBeenCalled();
  });

  it.each(['released', 'cancelled', 'expired', 'disputed'])(
    'rejects cancellation when the order is already "%s"',
    async (orderStatus) => {
      repo.findById.mockResolvedValue({ ...baseOrder, orderStatus });

      await expect(service.cancel('order-1', 'buyer-1')).rejects.toThrow();
      expect(repo.update).not.toHaveBeenCalled();
    },
  );

  it.each(['funded', 'fiat_sent', 'released', 'disputed', 'resolved'])(
    'rejects cancellation when the escrow is already "%s"',
    async (escrowStatus) => {
      repo.findById.mockResolvedValue({
        ...baseOrder,
        escrow: { escrowStatus },
      });

      await expect(service.cancel('order-1', 'buyer-1')).rejects.toThrow();
      expect(repo.update).not.toHaveBeenCalled();
    },
  );
});

describe('OrderService.getUserStats access policy', () => {
  let service: OrderService;
  const repo = { getUserStats: jest.fn() };
  const prisma = { appUser: { findUnique: jest.fn() } };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderService,
        { provide: OrderRepository, useValue: repo },
        { provide: EscrowService, useValue: {} },
        { provide: AuditLogService, useValue: { create: jest.fn() } },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(OrderService);
    repo.getUserStats.mockResolvedValue({ totalOrders: 3, completedOrders: 1 });
  });

  it('allows an authenticated user to read only their own counters', async () => {
    await expect(service.getUserStats('owner-1', 'owner-1')).resolves.toEqual({
      totalOrders: 3,
      completedOrders: 1,
    });
    expect(prisma.appUser.findUnique).not.toHaveBeenCalled();
    expect(repo.getUserStats).toHaveBeenCalledWith('owner-1');
  });

  it('allows an administrator to read another account counters', async () => {
    prisma.appUser.findUnique.mockResolvedValue({ role: 'admin' });

    await expect(service.getUserStats('target-1', 'admin-1')).resolves.toEqual({
      totalOrders: 3,
      completedOrders: 1,
    });
    expect(repo.getUserStats).toHaveBeenCalledWith('target-1');
  });

  it('denies a non-admin reading another account counters', async () => {
    prisma.appUser.findUnique.mockResolvedValue({ role: 'user' });

    await expect(service.getUserStats('target-1', 'user-1'))
      .rejects.toMatchObject({
        status: 403,
        response: expect.objectContaining({ error: 'UNAUTHORIZED_ACTION' }),
      });
    expect(repo.getUserStats).not.toHaveBeenCalled();
  });
});
