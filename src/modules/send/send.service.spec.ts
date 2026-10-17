import { SendService } from './send.service';

describe('SendService', () => {
  const publicKey = `G${'A'.repeat(55)}`;
  let config: { get: jest.Mock };
  let stellar: {
    getBalances: jest.Mock;
    buildUnsignedUsdcSend: jest.Mock;
    submitSignedXdr: jest.Mock;
  };
  let users: { findByPublicKey: jest.Mock; findByAlias: jest.Mock };
  let service: SendService;

  beforeEach(() => {
    config = {
      get: jest.fn((key: string) =>
        key === 'IKASH_TREASURY_ADDRESS' ? publicKey : undefined,
      ),
    };
    stellar = {
      getBalances: jest.fn(),
      buildUnsignedUsdcSend: jest.fn().mockResolvedValue({
        xdr: 'unsigned-xdr',
        networkPassphrase: 'testnet-passphrase',
      }),
      submitSignedXdr: jest.fn().mockResolvedValue({
        hash: 'tx-hash',
        ledger: 42,
        successful: true,
      }),
    };
    users = {
      findByPublicKey: jest.fn().mockResolvedValue({ alias: 'buyer' }),
      findByAlias: jest.fn().mockResolvedValue({ publicKey, alias: 'buyer' }),
    };
    service = new SendService(config as never, stellar as never, users as never);
  });

  it('resolves a Stellar address and an alias without live network calls', async () => {
    await expect(service['resolveRecipient'](publicKey)).resolves.toMatchObject({
      address: publicKey,
      alias: 'buyer',
    });
    await expect(service['resolveRecipient']('buyer')).resolves.toMatchObject({
      address: publicKey,
      alias: 'buyer',
    });
  });

  it('prepares USDC amount, fee, total, XDR, and network passphrase', async () => {
    const prepared = await service.prepare('Gsource', 'buyer', '100');

    expect(prepared).toMatchObject({
      asset: 'USDC',
      amount: '100',
      fee: '0.3',
      total: '100.3',
      unsignedXdr: 'unsigned-xdr',
      networkPassphrase: 'testnet-passphrase',
      recipient: { address: publicKey, alias: 'buyer' },
    });
    expect(stellar.buildUnsignedUsdcSend).toHaveBeenCalledWith(
      expect.objectContaining({ amount: '100', feeAmount: '0.3' }),
    );
  });

  it('rejects self-sends and invalid amounts before building a transaction', async () => {
    await expect(service.prepare(publicKey, publicKey, '1')).rejects.toThrow(
      'You cannot send funds to yourself.',
    );
    await expect(service.prepare('Gsource', 'buyer', '0.00000001')).rejects.toThrow();
    expect(stellar.buildUnsignedUsdcSend).not.toHaveBeenCalled();
  });

  it('submits the signed XDR and returns the Stellar result', async () => {
    await expect(service.submit('signed-xdr')).resolves.toEqual({
      hash: 'tx-hash',
      ledger: 42,
      successful: true,
    });
    expect(stellar.submitSignedXdr).toHaveBeenCalledWith('signed-xdr');
  });
});
