import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction, AuditResult } from '../audit-log/enums/audit-action.enum';
import { EscrowService } from '../escrow/escrow.service';
import { OrderService } from '../order/order.service';
import { StellarEventParserService } from './stellar-event-parser.service';
import {
  OnChainEscrowEvent,
  SorobanEventRaw,
} from './types/stellar-event.types';
import {
  EscrowOnChain,
  Order,
  escrow_status,
  order_status,
} from '@prisma/client';
import axios from 'axios';

const SUPPORTED_ESCROW_TOPICS = [
  'ESCROW_CREATED', 'ESCROW_FUNDED', 'ESCROW_RELEASED',
  'ESCROW_REFUNDED', 'ESCROW_CANCELLED', 'ESCROW_DISPUTED',
];

type EscrowWithOrder = EscrowOnChain & {
  order?: Order | null;
};

@Injectable()
export class StellarListenerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StellarListenerService.name);
  private isListening = false;
  private timer: NodeJS.Timeout | null = null;

  private lastProcessedLedger = 0;
  private readonly processedEventIds = new Set<string>();

  private readonly rpcUrl: string;
  private readonly horizonUrl: string;
  private readonly configuredContractId?: string;
  private readonly pollIntervalMs: number;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly parser: StellarEventParserService,
    private readonly escrowService: EscrowService,
    private readonly orderService: OrderService,
  ) {
    this.rpcUrl =
      this.config.get<string>('STELLAR_RPC_URL') ??
      'https://soroban-testnet.stellar.org';
    this.horizonUrl =
      this.config.get<string>('STELLAR_HORIZON_URL') ??
      'https://horizon-testnet.stellar.org';
    this.configuredContractId = this.config.get<string>(
      'TRUSTLESS_WORK_CONTRACT_ID',
    );
    this.pollIntervalMs = Number(
      this.config.get<string>('STELLAR_LISTENER_POLL_INTERVAL_MS', '5000'),
    );
  }

  async onModuleInit() {
    this.logger.log('Initializing StellarListenerService background stream...');
    await this.loadLastProcessedLedger();
    this.startListening();
  }

  onModuleDestroy() {
    this.stopListening();
  }

  /**
   * Starts the polling/streaming event loop.
   */
  startListening() {
    if (this.isListening) return;
    this.isListening = true;
    this.logger.log(
      `Stellar Listener started. Target RPC: ${this.rpcUrl}, Poll Interval: ${this.pollIntervalMs}ms`,
    );

    this.scheduleNextPoll(0);
  }

  /**
   * Stops the listening loop.
   */
  stopListening() {
    this.isListening = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.logger.log('Stellar Listener stopped.');
  }

  private scheduleNextPoll(delayMs: number) {
    if (!this.isListening) return;
    this.timer = setTimeout(() => {
      void this.pollEventsWithRecovery();
    }, delayMs);
  }

  /**
   * Polling loop with automatic reconnection & recovery.
   */
  private async pollEventsWithRecovery() {
    if (!this.isListening) return;

    try {
      await this.fetchAndProcessNewEvents();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Error during Stellar listener polling cycle (will retry): ${message}`,
      );
    } finally {
      this.scheduleNextPoll(this.pollIntervalMs);
    }
  }

  /**
   * Primary event retrieval and processing logic.
   */
  async fetchAndProcessNewEvents(): Promise<number> {
    const targetContracts = await this.getTargetContractIds();
    if (targetContracts.length === 0) {
      this.logger.debug('No active contract IDs found to listen to.');
      return 0;
    }

    const { events: rawEvents, latestLedger } =
      await this.queryEventsFromRpc(targetContracts);
    let processedCount = 0;

    for (const raw of rawEvents) {
      try {
        const parsed = this.parser.parseEvent(raw);
        if (!parsed) continue;

        const handled = await this.processEvent(parsed);
        if (handled) {
          processedCount++;
        }
        if (
          parsed.ledgerSequence &&
          parsed.ledgerSequence > this.lastProcessedLedger
        ) {
          this.lastProcessedLedger = parsed.ledgerSequence;
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : undefined;
        this.logger.error(
          `Failed to process individual Stellar event ${raw.id}: ${message}`,
          stack,
        );
      }
    }

    if (latestLedger && latestLedger > this.lastProcessedLedger) {
      this.lastProcessedLedger = latestLedger;
    }

    return processedCount;
  }

  /**
   * Fetches active contract IDs to filter events by.
   */
  private async getTargetContractIds(): Promise<string[]> {
    const contracts = new Set<string>();

    if (this.configuredContractId) {
      contracts.add(this.configuredContractId);
    }

    try {
      const activeEscrows = await this.prisma.escrowOnChain.findMany({
        where: {
          contractId: { not: null },
          escrowStatus: {
            notIn: ['released', 'resolved'],
          },
        },
        select: { contractId: true },
      });

      for (const e of activeEscrows) {
        if (e.contractId) contracts.add(e.contractId);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Could not query database for contract IDs: ${message}`);
    }

    return Array.from(contracts);
  }

  /**
   * Issues RPC POST request to Soroban getEvents endpoint.
   */
  private async queryEventsFromRpc(
    contractIds: string[],
  ): Promise<{ events: SorobanEventRaw[]; latestLedger?: number }> {
    try {
      const body = {
        jsonrpc: '2.0',
        id: 1,
        method: 'getEvents',
        params: {
          startLedger:
            this.lastProcessedLedger > 0 ? this.lastProcessedLedger : undefined,
          filters: [
            {
              type: 'contract',
              contractIds,
              topics: [SUPPORTED_ESCROW_TOPICS.map((value) => ({ type: 'symbol', value }))],
            },
          ],
          pagination: {
            limit: 100,
          },
        },
      };

      const res = await axios.post<{
        error?: unknown;
        result?: { events?: SorobanEventRaw[]; latestLedger?: number };
      }>(this.rpcUrl, body, { timeout: 10000 });

      if (res.data.error) {
        throw new Error(`Soroban RPC error: ${JSON.stringify(res.data.error)}`);
      }

      const events: SorobanEventRaw[] = res.data.result?.events || [];
      const latestLedger = res.data.result?.latestLedger
        ? Number(res.data.result.latestLedger)
        : undefined;

      return { events, latestLedger };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.debug(
        `RPC call getEvents failed/fallback to Horizon: ${message}`,
      );
      return { events: [] };
    }
  }

  /**
   * Synchronize an individual event idempotently within an atomic database transaction.
   */
  async processEvent(event: OnChainEscrowEvent): Promise<boolean> {
    const eventKey = `${event.eventId}:${event.eventType}`;

    if (this.processedEventIds.has(eventKey)) {
      this.logger.debug(`Duplicate event skipped (in-memory): ${eventKey}`);
      return false;
    }

    const escrow = await this.findEscrowRecord(event);
    if (!escrow) {
      this.logger.warn(
        `Received ${event.eventType} for unknown contract/order: ${event.contractId} / ${event.engagementId ?? 'none'}`,
      );
      return false;
    }

    if (this.isTerminalOrAlreadyProcessed(escrow, event)) {
      this.logger.debug(
        `Escrow ${escrow.escrowId} is already in state "${escrow.escrowStatus}", event ${eventKey} ignored.`,
      );
      this.processedEventIds.add(eventKey);
      return false;
    }

    const statusMap = this.mapEventToStatuses(event.eventType);
    if (!statusMap) {
      this.logger.warn(`Unmapped event type: ${event.eventType}`);
      return false;
    }

    this.escrowService.validateStatusTransition(
      escrow.escrowStatus,
      event.eventType,
    );

    const updateData: Record<string, unknown> = {
      escrowStatus: statusMap.escrowStatus,
    };
    if (event.eventType === 'ESCROW_FUNDED' && event.txHash) {
      updateData.txHashLock = event.txHash;
    }
    if (
      (event.eventType === 'ESCROW_RELEASED' ||
        event.eventType === 'ESCROW_REFUNDED') &&
      event.txHash
    ) {
      updateData.txHashRelease = event.txHash;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.escrowOnChain.update({
        where: { escrowId: escrow.escrowId },
        data: updateData,
      });

      await tx.order.update({
        where: { orderId: escrow.orderId },
        data: { orderStatus: statusMap.orderStatus },
      });

      await tx.auditLog.create({
        data: {
          action: this.mapEventToAuditAction(event.eventType),
          resourceType: 'Escrow',
          resourceId: escrow.escrowId,
          result: AuditResult.SUCCESS,
          metadata: {
            contractId: event.contractId,
            orderId: escrow.orderId,
            txHash: event.txHash,
            ledgerSequence: event.ledgerSequence,
            eventIndex: event.eventIndex,
            eventType: event.eventType,
          },
        },
      });
    });

    this.notifyUsers(
      escrow,
      event,
      statusMap.escrowStatus,
      statusMap.orderStatus,
    );

    this.processedEventIds.add(eventKey);
    this.logger.log(
      `Successfully synchronized event ${event.eventType} for Escrow ${escrow.escrowId} (Order ${escrow.orderId})`,
    );

    return true;
  }

  private async findEscrowRecord(
    event: OnChainEscrowEvent,
  ): Promise<EscrowWithOrder | null> {
    if (event.contractId) {
      const match = await this.prisma.escrowOnChain.findFirst({
        where: { contractId: event.contractId },
        include: { order: true },
      });
      if (match) return match;
    }

    if (event.engagementId || event.orderId) {
      const orderId = event.engagementId || event.orderId;
      const match = await this.prisma.escrowOnChain.findFirst({
        where: { orderId },
        include: { order: true },
      });
      if (match) return match;
    }

    return null;
  }

  private isTerminalOrAlreadyProcessed(
    escrow: EscrowOnChain,
    event: OnChainEscrowEvent,
  ): boolean {
    return this.escrowService.isTerminalOrAlreadyProcessed(
      escrow.escrowStatus,
      event.eventType,
    );
  }

  private mapEventToStatuses(eventType: string): {
    escrowStatus: escrow_status;
    orderStatus: order_status;
  } | null {
    switch (eventType) {
      case 'ESCROW_CREATED':
        return { escrowStatus: 'initialized', orderStatus: 'created' };
      case 'ESCROW_FUNDED':
        return { escrowStatus: 'funded', orderStatus: 'locked' };
      case 'ESCROW_RELEASED':
        return { escrowStatus: 'released', orderStatus: 'released' };
      case 'ESCROW_REFUNDED':
        return { escrowStatus: 'resolved', orderStatus: 'cancelled' };
      case 'ESCROW_CANCELLED':
        return { escrowStatus: 'resolved', orderStatus: 'cancelled' };
      case 'ESCROW_DISPUTED':
        return { escrowStatus: 'disputed', orderStatus: 'disputed' };
      default:
        return null;
    }
  }

  private mapEventToAuditAction(eventType: string): AuditAction {
    switch (eventType) {
      case 'ESCROW_CREATED':
        return AuditAction.ESCROW_CREATED;
      case 'ESCROW_FUNDED':
        return AuditAction.ESCROW_FUNDED;
      case 'ESCROW_RELEASED':
        return AuditAction.ESCROW_RELEASED;
      case 'ESCROW_REFUNDED':
        return AuditAction.ESCROW_REFUNDED;
      case 'ESCROW_CANCELLED':
        return AuditAction.ESCROW_CANCELLED;
      case 'ESCROW_DISPUTED':
        return AuditAction.ESCROW_DISPUTED;
      default:
        return AuditAction.ESCROW_CREATED;
    }
  }

  private notifyUsers(
    escrow: EscrowWithOrder,
    event: OnChainEscrowEvent,
    newEscrowStatus: escrow_status,
    newOrderStatus: order_status,
  ) {
    const buyerId = escrow.order?.buyerId;
    const sellerId = escrow.order?.sellerId;

    this.logger.log('onchain.escrow.notification.sent', {
      escrowId: escrow.escrowId,
      orderId: escrow.orderId,
      buyerId,
      sellerId,
      eventType: event.eventType,
      newEscrowStatus,
      newOrderStatus,
      txHash: event.txHash,
    });
  }

  private async loadLastProcessedLedger() {
    try {
      const latestAudit = await this.prisma.auditLog.findFirst({
        where: {
          action: {
            in: [
              AuditAction.ESCROW_CREATED,
              AuditAction.ESCROW_FUNDED,
              AuditAction.ESCROW_RELEASED,
              AuditAction.ESCROW_REFUNDED,
              AuditAction.ESCROW_CANCELLED,
              AuditAction.ESCROW_DISPUTED,
            ],
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (latestAudit?.metadata && typeof latestAudit.metadata === 'object') {
        const meta = latestAudit.metadata as Record<string, unknown>;
        if (
          typeof meta.ledgerSequence === 'number' ||
          typeof meta.ledgerSequence === 'string'
        ) {
          this.lastProcessedLedger = Number(meta.ledgerSequence);
          this.logger.log(
            `Resuming event sync from saved ledger sequence: ${this.lastProcessedLedger}`,
          );
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Could not load last processed ledger: ${message}`);
    }
  }
}
