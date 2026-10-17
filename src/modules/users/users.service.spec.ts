import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from '../auth/auth.service';
import { FileStorageService } from '../file-storage/file-storage.service';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { PaymentMethodValidatorService } from '../payment-methods/payment-method-validator.service';
import { PaginationDto } from '../../common/pagination.dto';
import { USER_PUBLIC_SELECT } from '../../common/prisma-selects';
import { AuditLogService } from '../audit-log/audit-log.service';

describe('UsersService', () => {
  let service: UsersService;
  let repo: {
    update: jest.Mock;
    findById: jest.Mock;
    findMany: jest.Mock;
    findExportData: jest.Mock;
  };
  let mockFileStorageService: {
    uploadFile: jest.Mock;
  };
  let mockPrismaService: {
    waitlist: { findUnique: jest.Mock; deleteMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let mockAuditLogService: {
    create: jest.Mock;
  };
  let txClient: {
    paymentMethod: { deleteMany: jest.Mock };
    chatMessage: { updateMany: jest.Mock };
    auditLog: { updateMany: jest.Mock };
    waitlist: { deleteMany: jest.Mock };
    appUser: { findUnique: jest.Mock; update: jest.Mock };
  };

  beforeEach(async () => {
    repo = {
      update: jest.fn(),
      findById: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findExportData: jest.fn(),
    };

    mockFileStorageService = {
      uploadFile: jest.fn(),
    };

    txClient = {
      paymentMethod: { deleteMany: jest.fn() },
      chatMessage: { updateMany: jest.fn() },
      auditLog: { updateMany: jest.fn() },
      waitlist: { deleteMany: jest.fn() },
      appUser: { findUnique: jest.fn(), update: jest.fn() },
    };

    mockPrismaService = {
      waitlist: { findUnique: jest.fn(), deleteMany: jest.fn() },
      $transaction: jest.fn((cb: (tx: typeof txClient) => unknown) =>
        cb(txClient),
      ),
    };

    mockAuditLogService = {
      create: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: UsersRepository, useValue: repo },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AuthService, useValue: {} },
        { provide: FileStorageService, useValue: mockFileStorageService },
        { provide: PaymentMethodValidatorService, useValue: {} },
        { provide: AuditLogService, useValue: mockAuditLogService },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  it('lists users through a projection that omits the auth nonce', async () => {
    await service.list({ skip: 0, take: 20 } as PaginationDto);

    const [args] = repo.findMany.mock.calls[0] as [
      { select?: Record<string, unknown> },
    ];

    expect(args.select).toEqual(USER_PUBLIC_SELECT);
    expect(args.select).not.toHaveProperty('currentNonce');
  });

  it('updates the user when the authenticated user owns the resource', async () => {
    const updatedUser = { userId: 'user-1', alias: 'new-alias' };
    repo.findById.mockResolvedValue({ userId: 'user-1', alias: 'new-alias' });
    repo.update.mockResolvedValue(updatedUser);

    await expect(
      service.update('user-1', { alias: 'new-alias' }, 'user-1'),
    ).resolves.toEqual(updatedUser);

    expect(repo.update).toHaveBeenCalledWith('user-1', {
      alias: 'new-alias',
      aliasNormalized: 'new-alias',
    });
  });

  it('sets kycUpdatedAt only after ownership is validated', async () => {
    repo.update.mockResolvedValue({ userId: 'user-1', kycStatus: 'approved' });

    await service.update('user-1', { kycStatus: 'approved' }, 'user-1');

    const calls = repo.update.mock.calls as [[string, Record<string, unknown>]];

    expect(calls[0][0]).toBe('user-1');
    expect(calls[0][1].kycStatus).toBe('approved');
    expect(calls[0][1].kycUpdatedAt).toBeInstanceOf(Date);
  });

  it('rejects attempts to update another user resource', async () => {
    await expect(
      service.update('user-2', { alias: 'taken' }, 'user-1'),
    ).rejects.toThrow();

    expect(repo.update).not.toHaveBeenCalled();
  });

  it('rejects update attempts without an authenticated user id', async () => {
    await expect(
      service.update('user-1', { alias: 'new-alias' }),
    ).rejects.toThrow();

    expect(repo.update).not.toHaveBeenCalled();
  });

  describe('uploadProfilePicture', () => {
    it('should upload file and update user profileImageUrl when MOCK_PROFILE_UPLOAD is false', async () => {
      process.env.MOCK_PROFILE_UPLOAD = 'false';
      const mockFile = {
        originalname: 'test.jpg',
        mimetype: 'image/jpeg',
        size: 100,
        buffer: Buffer.from('data'),
      };

      const mockStoredFile = {
        key: 'path/to/test.jpg',
        url: 'http://gcs.local/path/to/test.jpg',
      };
      mockFileStorageService.uploadFile = jest
        .fn()
        .mockResolvedValue(mockStoredFile);

      const mockUser = { userId: 'user-1', alias: 'test' };
      repo.findById = jest.fn().mockResolvedValue(mockUser);
      repo.update = jest.fn().mockResolvedValue({
        ...mockUser,
        profileImageUrl: mockStoredFile.url,
      });

      const result = await service.uploadProfilePicture('user-1', mockFile);

      expect(repo.findById).toHaveBeenCalledWith('user-1');
      expect(mockFileStorageService.uploadFile).toHaveBeenCalledWith(mockFile);
      expect(repo.update).toHaveBeenCalledWith('user-1', {
        profileImageUrl: mockStoredFile.url,
      });
      expect(result.profileImageUrl).toBe(mockStoredFile.url);
    });

    it('should throw an error if user is not found', async () => {
      process.env.MOCK_PROFILE_UPLOAD = 'false';
      repo.findById = jest.fn().mockResolvedValue(null);
      mockFileStorageService.uploadFile = jest.fn();

      const mockFile = {
        originalname: 'test.jpg',
        mimetype: 'image/jpeg',
        size: 100,
        buffer: Buffer.from('data'),
      };

      await expect(
        service.uploadProfilePicture('non-existent-id', mockFile),
      ).rejects.toThrow();
      expect(mockFileStorageService.uploadFile).not.toHaveBeenCalled();
    });

    it('should return mock response without hitting DB when MOCK_PROFILE_UPLOAD is true', async () => {
      process.env.MOCK_PROFILE_UPLOAD = 'true';
      const mockFile = {
        originalname: 'test.jpg',
        mimetype: 'image/jpeg',
        size: 100,
        buffer: Buffer.from('data'),
      };

      const mockStoredFile = {
        key: 'mock-path',
        url: 'http://mock-url.local/mock-path',
      };
      mockFileStorageService.uploadFile = jest
        .fn()
        .mockResolvedValue(mockStoredFile);
      repo.update = jest.fn();

      const result = await service.uploadProfilePicture('user-1', mockFile);

      expect(mockFileStorageService.uploadFile).toHaveBeenCalledWith(mockFile);
      expect(repo.update).not.toHaveBeenCalled();
      expect(result.profileImageUrl).toBe(mockStoredFile.url);
    });
  });

  describe('exportUserData', () => {
    it("rejects a caller exporting another user's data", async () => {
      await expect(
        service.exportUserData('user-1', 'user-2'),
      ).rejects.toThrow();
      expect(repo.findExportData).not.toHaveBeenCalled();
    });

    it('rejects an unauthenticated export request', async () => {
      await expect(service.exportUserData('user-1')).rejects.toThrow();
      expect(repo.findExportData).not.toHaveBeenCalled();
    });

    it('throws when the user does not exist', async () => {
      repo.findExportData.mockResolvedValue(null);

      await expect(
        service.exportUserData('user-1', 'user-1'),
      ).rejects.toThrow();
    });

    it('returns the profile plus linked data and a matching waitlist row', async () => {
      const exportRecord = {
        userId: 'user-1',
        email: 'user@example.com',
        paymentMethods: [{ paymentId: 'pm-1' }],
        auditLogs: [{ id: 'log-1' }],
        offers: [],
        buyOrders: [],
        sellOrders: [],
        chatMessages: [],
      };
      repo.findExportData.mockResolvedValue(exportRecord);
      mockPrismaService.waitlist.findUnique.mockResolvedValue({
        id: 'wl-1',
        email: 'user@example.com',
      });

      const result = await service.exportUserData('user-1', 'user-1');

      expect(mockPrismaService.waitlist.findUnique).toHaveBeenCalledWith({
        where: { email: 'user@example.com' },
      });
      expect(result).toMatchObject({
        ...exportRecord,
        waitlist: { id: 'wl-1', email: 'user@example.com' },
      });
      expect(mockAuditLogService.create).toHaveBeenCalledWith(
        expect.objectContaining({ resourceId: 'user-1' }),
      );
    });

    it('skips the waitlist lookup when the user has no email on file', async () => {
      repo.findExportData.mockResolvedValue({ userId: 'user-1', email: null });

      const result = await service.exportUserData('user-1', 'user-1');

      expect(mockPrismaService.waitlist.findUnique).not.toHaveBeenCalled();
      expect(result.waitlist).toBeNull();
    });
  });

  describe('remove', () => {
    it("rejects a caller deleting another user's account", async () => {
      await expect(service.remove('user-1', 'user-2')).rejects.toThrow();
      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    it('throws when the user does not exist', async () => {
      txClient.appUser.findUnique.mockResolvedValue(null);

      await expect(service.remove('user-1', 'user-1')).rejects.toThrow();
      expect(txClient.appUser.update).not.toHaveBeenCalled();
      expect(txClient.paymentMethod.deleteMany).not.toHaveBeenCalled();
    });

    it('anonymizes linked PII and marks the account deleted instead of hard-deleting it', async () => {
      txClient.appUser.findUnique.mockResolvedValue({
        userId: 'user-1',
        email: 'user@example.com',
      });
      txClient.appUser.update.mockResolvedValue({
        userId: 'user-1',
        email: null,
        deletedAt: new Date(),
      });

      const result = await service.remove('user-1', 'user-1');

      expect(txClient.paymentMethod.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
      expect(txClient.chatMessage.updateMany).toHaveBeenCalledWith({
        where: { senderId: 'user-1' },
        data: { content: '[deleted]' },
      });
      expect(txClient.auditLog.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        data: { ipAddress: null, userAgent: null },
      });
      expect(txClient.waitlist.deleteMany).toHaveBeenCalledWith({
        where: { email: 'user@example.com' },
      });
      const updateCall = txClient.appUser.update.mock.calls[0] as [
        { where: { userId: string }; data: Record<string, unknown> },
      ];
      expect(updateCall[0].where).toEqual({ userId: 'user-1' });
      expect(updateCall[0].data).toMatchObject({ email: null, alias: null });
      expect(result.email).toBeNull();
      expect(mockAuditLogService.create).toHaveBeenCalledWith(
        expect.objectContaining({ resourceId: 'user-1' }),
      );
    });

    it('skips the waitlist cleanup when the user has no email on file', async () => {
      txClient.appUser.findUnique.mockResolvedValue({
        userId: 'user-1',
        email: null,
      });
      txClient.appUser.update.mockResolvedValue({ userId: 'user-1' });

      await service.remove('user-1', 'user-1');

      expect(txClient.waitlist.deleteMany).not.toHaveBeenCalled();
    });
  });
});
