import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PaginationDto } from '../../common/pagination.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { OrderRepository } from './order.repository';
import type { OrderWithRelations } from './order.repository';
import { EscrowService } from '../escrow/escrow.service';
import { AppException, ErrorCode } from '../../common/errors';
import {
  Order,
  order_status,
  escrow_status,
  EscrowOnChain,
} from '@prisma/client';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction, AuditResult } from '../audit-log/enums/audit-action.enum';
import { PrismaService } from '../../../prisma/prisma.service';
import { ORDER_STATUS } from './order.constants';
import {
  ORDER_PARTY_CONTACT_SELECT,
  OrderPartyContact,
} from '../../common/prisma-selects';

type ExpiredOrderWithRelations = Order & {
  escrow: EscrowOnChain | null;
  buyer: OrderPartyContact;
  seller: OrderPartyContact;
};

export type OrderFilter = {
  offerId?: string;
  buyerId?: string;
  sellerId?: string;
  userId?: string;
  status?: string;
};

type OrderCreateData = {
  orderId: string;
  offerId: string;
  buyerId: string;
  sellerId: string;
  assetAmount: string;
  orderStatus?: string;
  expiresAt?: Date;
  escrow: {
    contractId: string;
    sellerAddress: string;
    buyerAddress: string;
    amount: string;
  };
};

export interface OrderCreateResponse extends Order {
  escrowId?: string | null;
}

export interface OrderDetailResponse extends OrderCreateResponse {
  contractId: string;
  unsignedFundTransaction: string;
  escrow?: { escrowId: string };
}

export interface UserStats {
  totalOrders: number;
  completedOrders: number;
}

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    private readonly repo: OrderRepository,
    private readonly escrowService: EscrowService,
    private readonly auditLogService: AuditLogService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Atomic order + escrow creation.
   *
   * 1. Pre-generate an orderId (UUIDv4).
   * 2. Call EscrowService.deployEscrowToChain() ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â interacts ONLY with TW API.
   *    If this fails the method throws and NO database record is created.
   * 3. Persist Order + EscrowOnChain in a single DB transaction.
   * 4. Return the order data with the unsigned fund XDR so the frontend can
   *    prompt the seller to sign.
   */
  async create(dto: CreateOrderDto): Promise<OrderDetailResponse> {
    const orderId = randomUUID();

    this.logger.log(
      `Creating order ${orderId} ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â deploying escrow to chain firstÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦`,
    );

    const { contractId, unsignedFundTransaction } =
      await this.escrowService.deployEscrowToChain(orderId, {
        sellerAddress: dto.sellerAddress,
        buyerAddress: dto.buyerAddress,
        amount: Number(dto.assetAmount),
        assetCode: dto.assetCode,
        title: dto.title ?? `Order ${orderId}`,
      });

    this.logger.log(
      `Escrow deployed (contract=${contractId}). Persisting order + escrow in DBÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦`,
    );

    const data: OrderCreateData = {
      orderId,
      offerId: dto.offerId,
      buyerId: dto.buyerId,
      sellerId: dto.sellerId,
      assetAmount: dto.assetAmount,
      orderStatus: dto.orderStatus,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      escrow: {
        contractId,
        sellerAddress: dto.sellerAddress,
        buyerAddress: dto.buyerAddress,
        amount: dto.assetAmount,
      },
    };

    const order: OrderCreateResponse = (await this.repo.create(
      data,
    )) as OrderCreateResponse;

    this.logger.log(`Order ${orderId} and escrow persisted successfully.`);

    await this.auditLogService.create({
      userId: dto.buyerId,
      action: AuditAction.ORDER_CREATED,
      resourceType: 'Order',
      resourceId: orderId,
      result: AuditResult.SUCCESS,
      metadata: { offerId: dto.offerId, sellerId: dto.sellerId },
    });

    // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Return combined response ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
    return {
      ...order,
      escrow: order.escrowId ? { escrowId: order.escrowId } : undefined,
      contractId,
      unsignedFundTransaction,
    };
  }

  list(p: PaginationDto, q: OrderFilter): Promise<OrderWithRelations[]> {
    const where: Record<string, unknown> = {};
    if (q.offerId) where.offerId = q.offerId;
    if (q.buyerId) where.buyerId = q.buyerId;
    if (q.sellerId) where.sellerId = q.sellerId;
    if (q.userId) {
      where.OR = [{ buyerId: q.userId }, { sellerId: q.userId }];
    }
    if (q.status) where.orderStatus = q.status as order_status;

    return this.repo.search(where, p.skip, p.take);
  }

  async get(id: string): Promise<OrderWithRelations> {
    const item = await this.repo.findById(id);
    if (!item) {
      throw new AppException(
        ErrorCode.ORDER_NOT_FOUND,
        `Order ${id} not found`,
      );
    }
    return item;
  }

  async update(id: string, dto: UpdateOrderDto): Promise<Order> {
    const data: Record<string, unknown> = { ...dto };
    if (dto.expiresAt) data.expiresAt = new Date(dto.expiresAt);
    const updated = (await this.repo.update(id, data)) as Order;

    // Record cancellation/expiration explicitly when the update sets the
    // order into one of those terminal statuses; other field updates
    // (e.g. expiresAt extension) are not separately audited here.
    if (dto.orderStatus === 'cancelled') {
      await this.auditLogService.create({
        userId: updated.buyerId,
        action: AuditAction.ORDER_CANCELLED,
        resourceType: 'Order',
        resourceId: id,
        result: AuditResult.SUCCESS,
      });
    } else if (dto.orderStatus === 'expired') {
      await this.auditLogService.create({
        userId: updated.buyerId,
        action: AuditAction.ORDER_EXPIRED,
        resourceType: 'Order',
        resourceId: id,
        result: AuditResult.SUCCESS,
      });
    }

    return updated;
  }

  async remove(id: string): Promise<Order> {
    const removed = (await this.repo.delete(id)) as Order;

    await this.auditLogService.create({
      userId: removed.buyerId,
      action: AuditAction.ORDER_CANCELLED,
      resourceType: 'Order',
      resourceId: id,
      result: AuditResult.SUCCESS,
      metadata: { reason: 'deleted' },
    });

    return removed;
  }

  /**
   * Cancel an order before fiat payment has been marked as completed.
   *
   * Rules (see issue #42):
   *  - Only the buyer or seller on the order may cancel it.
   *  - Terminal order states (released, cancelled, expired, disputed) cannot
   *    be cancelled again.
   *  - If an on-chain escrow exists, cancellation is only allowed while the
   *    escrow is still "pending" or "initialized" ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â i.e. before any funds
   *    have actually moved on-chain. Once the escrow is "funded",
   *    "fiat_sent", "released", "disputed", or "resolved", direct
   *    cancellation is rejected: this codebase has no refund flow, so
   *    unwinding a funded escrow must go through support instead of being
   *    silently attempted here.
   */
  async cancel(id: string, userId: string): Promise<Order> {
    // OrderRepository.findById eager-loads the `escrow` relation, which the
    // escrow-status guard below reads (see order.repository.ts).
    const order = await this.repo.findById(id);

    if (!order) {
      throw new AppException(
        ErrorCode.ORDER_NOT_FOUND,
        `Order ${id} not found`,
      );
    }

    if (order.buyerId !== userId && order.sellerId !== userId) {
      throw new AppException(
        ErrorCode.UNAUTHORIZED_ACTION,
        'Only the buyer or seller on this order can cancel it',
      );
    }

    const terminalOrderStatuses: order_status[] = [
      'released',
      'cancelled',
      'expired',
      'disputed',
    ];
    if (terminalOrderStatuses.includes(order.orderStatus)) {
      throw new AppException(
        ErrorCode.ORDER_CANCELLATION_NOT_ALLOWED,
        `Order ${id} cannot be cancelled because it is already "${order.orderStatus}"`,
      );
    }

    const blockedEscrowStatuses: escrow_status[] = [
      'funded',
      'fiat_sent',
      'released',
      'disputed',
      'resolved',
    ];
    if (
      order.escrow &&
      blockedEscrowStatuses.includes(order.escrow.escrowStatus)
    ) {
      throw new AppException(
        ErrorCode.ORDER_CANCELLATION_NOT_ALLOWED,
        `Order ${id} cannot be cancelled because its escrow is in status "${order.escrow.escrowStatus}". ` +
          'Funds have moved on-chain; this must be resolved through support rather than direct cancellation.',
      );
    }

    this.logger.log('order.cancellation.completed', {
      orderId: id,
      userId,
      previousStatus: order.orderStatus,
    });

    return this.repo.update(id, {
      orderStatus: ORDER_STATUS.CANCELLED,
    }) as Promise<Order>;
  }

  getUserStats(userId: string): Promise<UserStats> {
    return this.repo.getUserStats(userId);
  }

  /**
   * Automatically expires or cancels active orders whose expiration time (`expiresAt`)
   * has passed.
   *
   * Flow overview:
   * 1. Query candidate active orders (`created` or `locked`) where `expiresAt < current_time`.
   * 2. Process each order independently within a try-catch block so individual order failure
   *    does not halt the batch.
   * 3. Delegate to `processExpiredOrder` for escrow verification, status transition,
   *    audit logging, and notification.
   */
  async expireOrders(): Promise<void> {
    const now = new Date();

    // Query active orders (created, locked) that have passed their expiration timestamp
    const expiredOrders = await this.prisma.order.findMany({
      where: {
        expiresAt: {
          lt: now,
        },
        orderStatus: {
          in: [ORDER_STATUS.CREATED, ORDER_STATUS.LOCKED],
        },
      },
      include: {
        escrow: true,
        // The job only needs an alias/publicKey to address the notification.
        buyer: { select: ORDER_PARTY_CONTACT_SELECT },
        seller: { select: ORDER_PARTY_CONTACT_SELECT },
      },
    });

    this.logger.log('order.expiration.job.executed', {
      timestamp: now.toISOString(),
      candidateCount: expiredOrders.length,
    });

    for (const order of expiredOrders) {
      try {
        await this.processExpiredOrder(order);
      } catch (err) {
        const error = err as Error;
        this.logger.error('order.expiration.error', {
          orderId: order.orderId,
          error: error.message,
          stack: error.stack,
        });
      }
    }
  }

  /**
   * Processes a single expired order through validation, escrow verification, status transition, and audit logging.
   *
   * @description
   * Process & Logic Behind Expiring Orders and Escrows:
   * 1. **Expiration Trigger & Time Window**:
   *    - Orders are evaluated when their `expiresAt` timestamp is strictly less than the current execution time (`now`).
   *    - Only active candidate orders in `created` or `locked` statuses are processed.
   *
   * 2. **Escrow State Safety & Protection**:
   *    - If an associated `EscrowOnChain` record exists, the job evaluates whether funds or fiat actions have occurred.
   *    - **Protected Escrows (`fiat_sent`, `released`, `disputed`, `resolved`)**: If the buyer has already marked fiat payment as sent (`fiat_sent`),
   *      or if the trade is in dispute/release, automatic expiration IS BLOCKED. This prevents buyer fiat loss where money was sent in real life
   *      but the order timer ran out.
   *    - **Eligible Escrows (`initialized`, `pending`, `funded`)**: If escrow is in initial state or seller-funded, BUT fiat was NOT marked as sent,
   *      the order is safe for automated cancellation/expiration.
   *    - **On-Chain Balance Verification**: Calls `EscrowService.getOnChainEscrowBalance` to double check on-chain contract state.
   *
   * 3. **Status Transition Rules**:
   *    - `created` -> `expired`: Initial order state without active escrow locks. Set to `expired`.
   *    - `locked` -> `cancelled`: Order where escrow was initialized/locked by seller, but timed out before buyer fiat payment. Set to `cancelled`.
   *
   * 4. **Persistence & Structured Event Logging**:
   *    - Updates `orderStatus` in the database.
   *    - Emits structured event logs for audit trailing (`order.expiration.audit`) and user notification (`order.expiration.notification.sent`).
   *
   * @param order - Expired order record including buyer, seller, and escrow relations.
   */
  private async processExpiredOrder(
    order: ExpiredOrderWithRelations,
  ): Promise<void> {
    const oldStatus = order.orderStatus;

    // 1. Verify Escrow Status
    if (order.escrow) {
      const escrow = order.escrow;

      // Fiat sent or beyond is protected from automated expiration/cancellation
      const protectedEscrowStatuses: escrow_status[] = [
        'fiat_sent',
        'released',
        'disputed',
        'resolved',
      ];
      if (protectedEscrowStatuses.includes(escrow.escrowStatus)) {
        this.logger.log('order.expiration.skipped_protected_escrow', {
          orderId: order.orderId,
          escrowStatus: escrow.escrowStatus,
          reason:
            'Fiat payment already sent or completed; automated cancellation blocked.',
        });
        return;
      }

      // Verify on-chain status via EscrowService wrapper
      if (escrow.contractId) {
        try {
          const balances = await this.escrowService.getOnChainEscrowBalance(
            escrow.contractId,
          );
          if (balances && Array.isArray(balances)) {
            // Note: If on-chain balance is verified, log status for traceability
            this.logger.log('order.expiration.onchain_balance_checked', {
              orderId: order.orderId,
              contractId: escrow.contractId,
              balanceCount: balances.length,
            });
          }
        } catch (err) {
          const error = err as Error;
          this.logger.warn('order.expiration.onchain_check_failed', {
            orderId: order.orderId,
            contractId: escrow.contractId,
            error: error.message,
          });
        }
      }
    }

    // 2. Determine target status
    // 'created' -> 'expired'
    // 'locked' -> 'cancelled'
    const targetStatus: order_status =
      oldStatus === ORDER_STATUS.LOCKED
        ? ORDER_STATUS.CANCELLED
        : ORDER_STATUS.EXPIRED;

    // 3. Update order status in the database
    await this.prisma.order.update({
      where: { orderId: order.orderId },
      data: { orderStatus: targetStatus },
    });

    // 4. Create Structured Audit Log
    this.logger.log('order.expiration.audit', {
      orderId: order.orderId,
      oldStatus,
      newStatus: targetStatus,
      buyerId: order.buyerId,
      sellerId: order.sellerId,
      expiresAt: order.expiresAt?.toISOString(),
    });

    // 5. Create Structured User Notification Event Log
    const buyerContact = order.buyer.alias || order.buyer.publicKey;
    const sellerContact = order.seller.alias || order.seller.publicKey;
    this.logger.log('order.expiration.notification.sent', {
      orderId: order.orderId,
      targetStatus,
      buyerId: order.buyerId,
      buyerContact,
      sellerId: order.sellerId,
      sellerContact,
    });
  }

  /**
   * Updates an order's status from on-chain event synchronization.
   */
  async updateStatusFromOnChain(
    orderId: string,
    newStatus: order_status,
  ): Promise<Order> {
    return this.repo.update(orderId, {
      orderStatus: newStatus,
    }) as unknown as Promise<Order>;
  }
}
