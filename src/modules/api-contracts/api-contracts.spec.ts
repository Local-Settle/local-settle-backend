type Fixture = Record<string, unknown>;
const user = require('./fixtures/user.json') as Fixture;
const offer = require('./fixtures/offer.json') as Fixture;
const order = require('./fixtures/order.json') as Fixture;
const escrow = require('./fixtures/escrow.json') as Fixture;
const sendPrepare = require('./fixtures/send-prepare.json') as Fixture;

function requireKeys(value: Record<string, unknown>, keys: string[]): void {
  for (const key of keys) expect(value).toHaveProperty(key);
}

describe('versioned frontend response fixtures', () => {
  it('keeps the public user response fields available', () => {
    requireKeys(user, ['userId', 'publicKey', 'alias', 'username', 'kycStatus']);
    expect(typeof user.publicKey).toBe('string');
  });

  it('keeps offer and order response fields used by the marketplace', () => {
    requireKeys(offer, ['offerId', 'creatorId', 'type', 'assetCode', 'price', 'status', 'payment_methods']);
    requireKeys(order, ['orderId', 'offerId', 'buyerId', 'sellerId', 'assetAmount', 'fiatAmount', 'orderStatus', 'escrow']);
  });

  it('keeps escrow and unsigned-send transaction fields stable', () => {
    requireKeys(escrow, ['escrowId', 'orderId', 'contractId', 'escrowStatus', 'amount']);
    requireKeys(sendPrepare, ['recipient', 'asset', 'amount', 'fee', 'total', 'unsignedXdr', 'networkPassphrase']);
    requireKeys(sendPrepare.recipient as Fixture, ['address', 'alias']);
  });
});
