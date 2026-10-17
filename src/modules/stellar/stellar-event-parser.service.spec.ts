import { Test, TestingModule } from '@nestjs/testing';
import { StellarEventParserService } from './stellar-event-parser.service';
import { escrowEventFixtures } from './fixtures/escrow-events';

describe('StellarEventParserService', () => {
  let parser: StellarEventParserService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StellarEventParserService],
    }).compile();

    parser = module.get<StellarEventParserService>(StellarEventParserService);
  });

  it('should be defined', () => {
    expect(parser).toBeDefined();
  });

  it('parses the shared, versioned event fixtures', () => {
    for (const fixture of escrowEventFixtures) {
      expect(parser.parseEvent(fixture.raw)?.eventType ?? null).toBe(
        fixture.expectedType,
      );
    }
  });

  it('should parse ESCROW_FUNDED event correctly', () => {
    const rawEvent = {
      id: '0000001:0',
      contractId: 'CCONTRACT123456789',
      txHash: '0xhash123',
      ledger: 100500,
      eventIndex: 1,
      topics: ['ESCROW_FUNDED', 'order-uuid-1234'],
      value: { amount: '500.00', engagementId: 'order-uuid-1234' },
    };

    const result = parser.parseEvent(rawEvent);
    expect(result).not.toBeNull();
    expect(result?.eventType).toBe('ESCROW_FUNDED');
    expect(result?.contractId).toBe('CCONTRACT123456789');
    expect(result?.txHash).toBe('0xhash123');
    expect(result?.ledgerSequence).toBe(100500);
    expect(result?.engagementId).toBe('order-uuid-1234');
    expect(result?.amount).toBe('500.00');
  });

  it('should parse ESCROW_RELEASED event correctly', () => {
    const rawEvent = {
      id: '0000002:1',
      contract_id: 'CCONTRACT123456789',
      tx_hash: '0xreleasehash',
      ledgerSequence: 100550,
      index: 0,
      eventType: 'ESCROW_RELEASED',
      engagementId: 'order-uuid-5678',
    };

    const result = parser.parseEvent(rawEvent);
    expect(result).not.toBeNull();
    expect(result?.eventType).toBe('ESCROW_RELEASED');
    expect(result?.contractId).toBe('CCONTRACT123456789');
    expect(result?.txHash).toBe('0xreleasehash');
    expect(result?.engagementId).toBe('order-uuid-5678');
  });

  it('should parse ESCROW_CREATED event correctly', () => {
    const rawEvent = {
      id: '0000003:0',
      contractId: 'CCONTRACT123456789',
      txHash: '0xcreatedhash',
      ledger: 100400,
      eventIndex: 0,
      topics: ['ESCROW_CREATED', 'order-uuid-created'],
      value: { amount: '100.00', engagementId: 'order-uuid-created' },
    };

    const result = parser.parseEvent(rawEvent);
    expect(result).not.toBeNull();
    expect(result?.eventType).toBe('ESCROW_CREATED');
    expect(result?.contractId).toBe('CCONTRACT123456789');
    expect(result?.engagementId).toBe('order-uuid-created');
  });

  it('should parse ESCROW_REFUNDED correctly without collision with FUNDED', () => {
    const rawEvent = {
      id: '0000004:0',
      contractId: 'CCONTRACT123456789',
      txHash: '0xrefundhash',
      ledger: 100600,
      eventIndex: 0,
      topics: ['REFUND', 'order-uuid-refund'],
      value: { engagementId: 'order-uuid-refund' },
    };

    const result = parser.parseEvent(rawEvent);
    expect(result).not.toBeNull();
    expect(result?.eventType).toBe('ESCROW_REFUNDED');
    expect(result?.contractId).toBe('CCONTRACT123456789');
    expect(result?.engagementId).toBe('order-uuid-refund');
  });

  it('should parse ESCROW_CANCELLED event correctly', () => {
    const rawEvent = {
      id: '0000005:0',
      contractId: 'CCONTRACT123456789',
      txHash: '0xcancelhash',
      ledger: 100650,
      eventIndex: 0,
      topics: ['CANCEL', 'order-uuid-cancel'],
      value: { engagementId: 'order-uuid-cancel' },
    };

    const result = parser.parseEvent(rawEvent);
    expect(result).not.toBeNull();
    expect(result?.eventType).toBe('ESCROW_CANCELLED');
    expect(result?.contractId).toBe('CCONTRACT123456789');
    expect(result?.engagementId).toBe('order-uuid-cancel');
  });

  it('should parse ESCROW_DISPUTED event correctly', () => {
    const rawEvent = {
      id: '0000006:0',
      contractId: 'CCONTRACT123456789',
      txHash: '0xdisputehash',
      ledger: 100700,
      eventIndex: 0,
      topics: ['DISPUTE', 'order-uuid-dispute'],
      value: { engagementId: 'order-uuid-dispute' },
    };

    const result = parser.parseEvent(rawEvent);
    expect(result).not.toBeNull();
    expect(result?.eventType).toBe('ESCROW_DISPUTED');
    expect(result?.contractId).toBe('CCONTRACT123456789');
    expect(result?.engagementId).toBe('order-uuid-dispute');
  });

  it('should return null for non-escrow or invalid event', () => {
    const result = parser.parseEvent(null);
    expect(result).toBeNull();

    const result2 = parser.parseEvent({ invalid: true });
    expect(result2).toBeNull();
  });
});
