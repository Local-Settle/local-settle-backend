jest.mock('@stellar/stellar-sdk', () => ({
  Horizon: { Server: jest.fn().mockImplementation(() => ({})) },
}));

import { ConfigService } from '@nestjs/config';
import { StellarService } from './stellar.service';

describe('StellarService payment asset identity', () => {
  const publicKey = `G${'A'.repeat(55)}`;

  it('distinguishes native XLM from issued assets without changing legacy fields', async () => {
    const issuer = `G${'C'.repeat(55)}`;
    const query = {
      forAccount: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({
        records: [
          {
            id: '1', transaction_hash: 'hash-1', created_at: '2026-10-17T00:00:00Z',
            type: 'payment', amount: '1', asset_type: 'native', from: publicKey,
            to: issuer,
          },
          {
            id: '2', transaction_hash: 'hash-2', created_at: '2026-10-17T00:00:00Z',
            type: 'payment', amount: '2', asset_type: 'credit_alphanum4',
            asset_code: 'USD', asset_issuer: issuer, from: issuer, to: publicKey,
          },
        ],
      }),
    };
    const service = new StellarService({ get: jest.fn() } as unknown as ConfigService);
    Object.defineProperty(service, 'server', {
      value: { payments: jest.fn().mockReturnValue(query) },
    });

    const records = await service.getTransactions(publicKey);

    expect(records[0]).toEqual(
      expect.objectContaining({
        asset: 'XLM',
        asset_issuer: null,
        asset_descriptor: { type: 'native', code: 'XLM', issuer: null },
      }),
    );
    expect(records[1]).toEqual(
      expect.objectContaining({
        asset: 'USD',
        asset_issuer: issuer,
        asset_descriptor: {
          type: 'credit_alphanum4',
          code: 'USD',
          issuer,
        },
      }),
    );
  });
});
