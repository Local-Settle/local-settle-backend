import { Test, TestingModule } from '@nestjs/testing';
import { PaymentMethodsService } from './payment-methods.service';
import { PaymentMethodsRepository } from './payment-methods.repository';
import { PaymentMethodValidatorService } from './payment-method-validator.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AppException, ErrorCode } from '../../common/errors';

async function expectAppException(
  promise: Promise<unknown>,
  statusCode: number,
  errorCode: ErrorCode,
  message: string,
): Promise<void> {
  let error: unknown;
  try {
    await promise;
    throw new Error('expected the promise to reject');
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(AppException);
  expect((error as AppException).getStatus()).toBe(statusCode);
  expect((error as AppException).getResponse()).toMatchObject({
    statusCode,
    error: errorCode,
    message,
  });
}

describe('PaymentMethodsService', () => {
  let service: PaymentMethodsService;
  let repo: {
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    findById: jest.Mock;
    findMany: jest.Mock;
  };
  let prisma: {
    payment_provider: { findUnique: jest.Mock };
  };
  let validator: { validate: jest.Mock };
  let auditLog: { create: jest.Mock };

  const provider = {
    provider_id: 'provider-1',
    name: 'PayPal',
    type: 'PLATFORM',
    country_code: '',
    metadata: {
      ui_requirements: [
        {
          db_field: 'account_identifier',
          label: 'PayPal email',
          type: 'email',
          required: true,
        },
      ],
    },
  };

  beforeEach(async () => {
    repo = {
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findById: jest.fn(),
      findMany: jest.fn(),
    };
    prisma = { payment_provider: { findUnique: jest.fn() } };
    validator = { validate: jest.fn().mockReturnValue(true) };
    auditLog = { create: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentMethodsService,
        { provide: PaymentMethodsRepository, useValue: repo },
        { provide: PrismaService, useValue: prisma },
        {
          provide: PaymentMethodValidatorService,
          useValue: validator,
        },
        { provide: AuditLogService, useValue: auditLog },
      ],
    }).compile();

    service = module.get(PaymentMethodsService);
  });

  describe('create', () => {
    const dto = {
      userId: 'user-1',
      providerId: 'provider-1',
      accountIdentifier: 'user@example.com',
    };

    it('validates the identifier before persisting', async () => {
      prisma.payment_provider.findUnique.mockResolvedValue(provider);
      repo.create.mockResolvedValue({ paymentId: 'pm-1', userId: 'user-1' });

      await service.create(dto);

      expect(prisma.payment_provider.findUnique).toHaveBeenCalledWith({
        where: { provider_id: 'provider-1' },
      });
      expect(validator.validate).toHaveBeenCalledWith(
        { type: 'PLATFORM', countryCode: '' },
        'user@example.com',
      );
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          providerId: 'provider-1',
          type: 'PLATFORM',
          accountIdentifier: 'user@example.com',
        }),
      );
    });

    it('throws PAYMENT_PROVIDER_NOT_FOUND when the provider does not exist', async () => {
      prisma.payment_provider.findUnique.mockResolvedValue(null);

      await expectAppException(
        service.create(dto),
        404,
        ErrorCode.PAYMENT_PROVIDER_NOT_FOUND,
        'Payment provider not found',
      );
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('throws INVALID_ACCOUNT_IDENTIFIER when validation fails', async () => {
      prisma.payment_provider.findUnique.mockResolvedValue(provider);
      validator.validate.mockImplementation(() => {
        throw new AppException(
          ErrorCode.INVALID_ACCOUNT_IDENTIFIER,
          'Invalid account identifier for the selected payment provider.',
        );
      });

      await expectAppException(
        service.create(dto),
        400,
        ErrorCode.INVALID_ACCOUNT_IDENTIFIER,
        'Invalid account identifier for the selected payment provider.',
      );
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('re-validates the identifier when the provider or identifier changes', async () => {
      repo.findById.mockResolvedValue({
        paymentId: 'pm-1',
        userId: 'user-1',
        providerId: 'provider-1',
        accountIdentifier: 'old@example.com',
      });
      prisma.payment_provider.findUnique.mockResolvedValue(provider);
      repo.update.mockResolvedValue({
        paymentId: 'pm-1',
        userId: 'user-1',
      });

      await service.update('pm-1', { accountIdentifier: 'new@example.com' });

      expect(validator.validate).toHaveBeenCalledWith(
        { type: 'PLATFORM', countryCode: '' },
        'new@example.com',
      );
    });

    it('throws PAYMENT_METHOD_NOT_FOUND when the payment method does not exist', async () => {
      repo.findById.mockResolvedValue(null);

      await expectAppException(
        service.update('missing', {}),
        404,
        ErrorCode.PAYMENT_METHOD_NOT_FOUND,
        'Payment method missing not found',
      );
      expect(prisma.payment_provider.findUnique).not.toHaveBeenCalled();
    });

    it('throws INVALID_ACCOUNT_IDENTIFIER when validation fails on update', async () => {
      repo.findById.mockResolvedValue({
        paymentId: 'pm-1',
        userId: 'user-1',
        providerId: 'provider-1',
        accountIdentifier: 'old@example.com',
      });
      prisma.payment_provider.findUnique.mockResolvedValue(provider);
      validator.validate.mockImplementation(() => {
        throw new AppException(
          ErrorCode.INVALID_ACCOUNT_IDENTIFIER,
          'Invalid account identifier for the selected payment provider.',
        );
      });

      await expectAppException(
        service.update('pm-1', { accountIdentifier: 'bad' }),
        400,
        ErrorCode.INVALID_ACCOUNT_IDENTIFIER,
        'Invalid account identifier for the selected payment provider.',
      );
      expect(repo.update).not.toHaveBeenCalled();
    });
  });
});
