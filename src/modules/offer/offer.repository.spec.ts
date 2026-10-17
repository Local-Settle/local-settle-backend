import { OfferRepository, OFFER_DETAIL_INCLUDE } from './offer.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  PAYMENT_METHOD_SELECT,
  PAYMENT_PROVIDER_SELECT,
} from '../../common/prisma-selects';

describe('OfferRepository', () => {
  const offer = {
    create: jest.fn().mockResolvedValue({ offerId: 'offer-1' }),
    findUnique: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
  };
  const paymentMethod = { findMany: jest.fn().mockResolvedValue([]) };

  const repo = new OfferRepository({
    offer,
    paymentMethod,
  } as unknown as PrismaService);

  beforeEach(() => {
    jest.clearAllMocks();
    offer.create.mockResolvedValue({ offerId: 'offer-1' });
    offer.findUnique.mockResolvedValue(null);
    offer.findMany.mockResolvedValue([]);
    paymentMethod.findMany.mockResolvedValue([]);
  });

  it('projects payment methods and their provider on every read', () => {
    expect(OFFER_DETAIL_INCLUDE.payment_methods).toEqual({
      select: PAYMENT_METHOD_SELECT,
    });
    expect(PAYMENT_METHOD_SELECT.payment_provider).toEqual({
      select: PAYMENT_PROVIDER_SELECT,
    });
  });

  it('searches with the projected include in a single query', async () => {
    await repo.search({ status: 'active' }, 0, 20);

    expect(offer.findMany).toHaveBeenCalledTimes(1);
    expect(offer.findMany).toHaveBeenCalledWith({
      where: { status: 'active' },
      skip: 0,
      take: 20,
      orderBy: { offerId: 'desc' },
      include: OFFER_DETAIL_INCLUDE,
    });
  });

  it('reads a single offer with the projected include', async () => {
    await repo.findById('offer-1');

    expect(offer.findUnique).toHaveBeenCalledWith({
      where: { offerId: 'offer-1' },
      include: OFFER_DETAIL_INCLUDE,
    });
  });

  it('creates without a payment-method pre-check when none are requested', async () => {
    await repo.create({ creatorId: 'user-1', type: 'sell' });

    expect(paymentMethod.findMany).not.toHaveBeenCalled();
    expect(offer.create).toHaveBeenCalledWith({
      data: { creatorId: 'user-1', type: 'sell', payment_methods: undefined },
      include: OFFER_DETAIL_INCLUDE,
    });
  });

  it('connects the payment methods that exist and returns them projected', async () => {
    paymentMethod.findMany.mockResolvedValue([{ paymentId: 'pm-1' }]);

    await repo.create({ creatorId: 'user-1', paymentMethodIds: ['pm-1'] });

    expect(paymentMethod.findMany).toHaveBeenCalledWith({
      where: {
        paymentId: { in: ['pm-1'] },
        userId: 'user-1',
        isActive: true,
      },
      select: { paymentId: true },
    });
    expect(offer.create).toHaveBeenCalledWith({
      data: {
        creatorId: 'user-1',
        payment_methods: { connect: [{ paymentId: 'pm-1' }] },
      },
      include: OFFER_DETAIL_INCLUDE,
    });
  });

  it('rejects a mixed set before creating the offer', async () => {
    paymentMethod.findMany.mockResolvedValue([{ paymentId: 'pm-1' }]);

    await expect(
      repo.create({
        creatorId: 'user-1',
        paymentMethodIds: ['pm-1', 'pm-foreign'],
      }),
    ).rejects.toThrow('Payment methods must be active and owned by the offer creator');
    expect(offer.create).not.toHaveBeenCalled();
  });
});
