import type { OnChainEscrowEventType } from '../types/stellar-event.types';

/** Sanitized Soroban RPC examples shared by parser and listener tests. */
export const ESCROW_EVENT_FIXTURE_METADATA = {
  network: 'testnet',
  protocolVersion: 'soroban-rpc-v1',
} as const;

export const escrowEventFixtures: Array<{
  name: string;
  raw: Record<string, unknown>;
  expectedType: OnChainEscrowEventType | null;
}> = [
  {
    name: 'create',
    raw: {
      id: 'fixture-create:0',
      contractId: 'CCONTRACT_FIXTURE',
      txHash: 'fixture-create',
      ledger: 100,
      eventIndex: 0,
      topics: ['ESCROW_CREATED', 'order-fixture-create'],
      value: { amount: '10.00', engagementId: 'order-fixture-create' },
    },
    expectedType: 'ESCROW_CREATED',
  },
  {
    name: 'fund',
    raw: {
      id: 'fixture-fund:0',
      contractId: 'CCONTRACT_FIXTURE',
      txHash: 'fixture-fund',
      ledger: 101,
      eventIndex: 0,
      topics: ['ESCROW_FUNDED', 'order-123'],
      value: { amount: '10.00', engagementId: 'order-123' },
    },
    expectedType: 'ESCROW_FUNDED',
  },
  {
    name: 'release',
    raw: {
      id: 'fixture-release:0',
      contractId: 'CCONTRACT_FIXTURE',
      txHash: 'fixture-release',
      ledger: 102,
      eventIndex: 0,
      topics: ['ESCROW_RELEASED', 'order-fixture-release'],
      value: { engagementId: 'order-fixture-release' },
    },
    expectedType: 'ESCROW_RELEASED',
  },
  {
    name: 'dispute',
    raw: {
      id: 'fixture-dispute:0',
      contractId: 'CCONTRACT_FIXTURE',
      txHash: 'fixture-dispute',
      ledger: 103,
      eventIndex: 0,
      topics: ['ESCROW_DISPUTED', 'order-fixture-dispute'],
      value: { engagementId: 'order-fixture-dispute' },
    },
    expectedType: 'ESCROW_DISPUTED',
  },
  {
    name: 'cancel',
    raw: {
      id: 'fixture-cancel:0',
      contractId: 'CCONTRACT_FIXTURE',
      txHash: 'fixture-cancel',
      ledger: 104,
      eventIndex: 0,
      topics: ['ESCROW_CANCELLED', 'order-fixture-cancel'],
      value: { engagementId: 'order-fixture-cancel' },
    },
    expectedType: 'ESCROW_CANCELLED',
  },
  {
    name: 'unknown',
    raw: {
      id: 'fixture-unknown:0',
      contractId: 'CCONTRACT_FIXTURE',
      txHash: 'fixture-unknown',
      ledger: 105,
      eventIndex: 0,
      topics: ['SOMETHING_ELSE'],
      value: {},
    },
    expectedType: null,
  },
];
