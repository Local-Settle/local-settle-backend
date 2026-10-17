import { Injectable, Logger } from '@nestjs/common';
import {
  OnChainEscrowEvent,
  OnChainEscrowEventType,
  SorobanEventRaw,
} from './types/stellar-event.types';

@Injectable()
export class StellarEventParserService {
  private readonly logger = new Logger(StellarEventParserService.name);

  /**
   * Parse a raw Soroban contract event or JSON payload into a normalized OnChainEscrowEvent.
   * Returns null if the event is not a recognized escrow event or is malformed.
   */
  parseEvent(
    rawEvent: SorobanEventRaw | Record<string, unknown> | null | undefined,
  ): OnChainEscrowEvent | null {
    if (!rawEvent || typeof rawEvent !== 'object') {
      return null;
    }

    try {
      const eventObj = rawEvent as SorobanEventRaw & Record<string, unknown>;

      const contractId = eventObj.contractId || eventObj.contract_id;
      const txHash =
        eventObj.txHash || eventObj.tx_hash || eventObj.transactionHash || '';
      const ledgerSequence = Number(
        eventObj.ledger || eventObj.ledgerSequence || 0,
      );
      const eventIndex = Number(eventObj.eventIndex || eventObj.index || 0);

      if (!contractId || typeof contractId !== 'string') {
        this.logger.debug('Event missing contractId, skipping');
        return null;
      }

      // Determine event type from topics or direct eventType field
      const rawTopics = Array.isArray(eventObj.topic)
        ? eventObj.topic
        : Array.isArray(eventObj.topics)
          ? eventObj.topics
          : [];

      const topics: string[] = rawTopics.map((t) => this.stringifyTopic(t));

      const directType =
        eventObj.eventType || eventObj.event_type || eventObj.type;
      const eventType = this.resolveEventType(directType, topics);

      if (!eventType) {
        this.logger.debug(
          `Could not resolve escrow event type for event ${String(eventObj.id)}`,
        );
        return null;
      }

      const eventId =
        typeof eventObj.id === 'string'
          ? eventObj.id
          : `${txHash}:${ledgerSequence}:${eventIndex}`;

      const engagementId = this.extractEngagementId(eventObj, topics);
      const amount = this.extractAmount(eventObj);

      const payload =
        typeof eventObj.value === 'object' && eventObj.value !== null
          ? (eventObj.value as Record<string, unknown>)
          : { value: eventObj.value };

      return {
        eventId,
        eventType,
        contractId,
        txHash: String(txHash),
        ledgerSequence,
        eventIndex,
        engagementId,
        amount,
        timestamp: eventObj.ledgerClosedAt
          ? new Date(eventObj.ledgerClosedAt)
          : new Date(),
        payload,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to parse event: ${message}`);
      return null;
    }
  }

  private stringifyTopic(topic: unknown): string {
    if (typeof topic === 'string') return topic;
    if (typeof topic === 'number' || typeof topic === 'boolean')
      return String(topic);
    if (topic && typeof topic === 'object') {
      const obj = topic as Record<string, unknown>;
      if (typeof obj._value === 'string' || typeof obj._value === 'number') {
        return String(obj._value);
      }
      if (typeof obj.value === 'string' || typeof obj.value === 'number') {
        return String(obj.value);
      }
      return JSON.stringify(topic);
    }
    return '';
  }

  private resolveEventType(
    directType: unknown,
    topics: string[],
  ): OnChainEscrowEventType | null {
    const candidates = [directType, ...topics]
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.toUpperCase());
    const supported = new Map<string, OnChainEscrowEventType>([
      ['ESCROW_CREATED', 'ESCROW_CREATED'], ['CREATED', 'ESCROW_CREATED'], ['INITIALIZE', 'ESCROW_CREATED'],
      ['ESCROW_FUNDED', 'ESCROW_FUNDED'], ['FUND', 'ESCROW_FUNDED'],
      ['ESCROW_RELEASED', 'ESCROW_RELEASED'], ['RELEASE', 'ESCROW_RELEASED'],
      ['ESCROW_REFUNDED', 'ESCROW_REFUNDED'], ['REFUND', 'ESCROW_REFUNDED'],
      ['ESCROW_CANCELLED', 'ESCROW_CANCELLED'], ['CANCEL', 'ESCROW_CANCELLED'],
      ['ESCROW_DISPUTED', 'ESCROW_DISPUTED'], ['DISPUTE', 'ESCROW_DISPUTED'],
    ]);
    for (const candidate of candidates) {
      const match = supported.get(candidate);
      if (match) return match;
    }
    return null;
  }

  private extractEngagementId(
    eventObj: Record<string, unknown>,
    topics: string[],
  ): string | undefined {
    if (typeof eventObj.engagementId === 'string') return eventObj.engagementId;
    if (typeof eventObj.orderId === 'string') return eventObj.orderId;

    if (eventObj.value && typeof eventObj.value === 'object') {
      const val = eventObj.value as Record<string, unknown>;
      if (typeof val.engagementId === 'string') return val.engagementId;
      if (typeof val.orderId === 'string') return val.orderId;
      if (typeof val.engagement_id === 'string') return val.engagement_id;
    }

    for (const t of topics) {
      if (
        t.startsWith('order_') ||
        t.startsWith('eng_') ||
        /^[0-9a-fA-F-]{36}$/.test(t)
      ) {
        return t;
      }
    }

    return undefined;
  }

  private extractAmount(eventObj: Record<string, unknown>): string | undefined {
    if (typeof eventObj.amount === 'string') return eventObj.amount;
    if (eventObj.value && typeof eventObj.value === 'object') {
      const val = eventObj.value as Record<string, unknown>;
      if (typeof val.amount === 'string' || typeof val.amount === 'number') {
        return String(val.amount);
      }
    }
    return undefined;
  }
}
