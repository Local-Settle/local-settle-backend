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

describe('OrderService.update status transitions', () => {
  let service: OrderService;
  const repo = {
    findById: jest.fn(),
    update: jest.fn(),
    updateIfStatusesMatch: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
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

  it('allows created to locked only after the escrow is funded', async () => {
    repo.findById.mockResolvedValue({ orderStatus: 'created', escrow: { escrowStatus: 'funded' } });
    repo.updateIfStatusesMatch.mockResolvedValue(true);

    await service.update('order-1', { orderStatus: 'locked' });

    expect(repo.updateIfStatusesMatch).toHaveBeenCalledWith(
      'order-1',
      'created',
      'funded',
      { orderStatus: 'locked' },
    );
  });

  it.each(['cancelled', 'expired', 'released', 'disputed'])(
    'rejects generic created -> %s transition with stable conflict code',
    async (orderStatus) => {
      repo.findById.mockResolvedValue({ orderStatus: 'created', escrow: null });

      await expect(service.update('order-1', { orderStatus: orderStatus as never }))
        .rejects.toMatchObject({
          status: 409,
          response: expect.objectContaining({ error: 'ORDER_INVALID_TRANSITION' }),
        });
      expect(repo.update).not.toHaveBeenCalled();
    },
  );

  it('cannot reopen a terminal order through generic PATCH', async () => {
    repo.findById.mockResolvedValue({ orderStatus: 'released', escrow: { escrowStatus: 'released' } });

    await expect(service.update('order-1', { orderStatus: 'created' }))
      .rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({ error: 'ORDER_INVALID_TRANSITION' }),
      });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('requires a released escrow before releasing a locked order', async () => {
    repo.findById.mockResolvedValue({ orderStatus: 'locked', escrow: { escrowStatus: 'funded' } });

    await expect(service.update('order-1', { orderStatus: 'released' }))
      .rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({ error: 'ORDER_INVALID_TRANSITION' }),
      });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('returns a stable conflict when status changes after validation', async () => {
    repo.findById.mockResolvedValue({
      orderStatus: 'created',
      escrow: { escrowStatus: 'funded' },
    });
    repo.updateIfStatusesMatch.mockResolvedValue(false);

    await expect(service.update('order-1', { orderStatus: 'locked' })).rejects
      .toMatchObject({
        status: 409,
        response: expect.objectContaining({ error: 'ORDER_INVALID_TRANSITION' }),
      });
    expect(repo.updateIfStatusesMatch).toHaveBeenCalledWith(
      'order-1',
      'created',
      'funded',
      { orderStatus: 'locked' },
    );
  });
});
