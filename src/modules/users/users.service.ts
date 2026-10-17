import { Injectable } from '@nestjs/common';
import { PaginationDto } from '../../common/pagination.dto';
import { CreateUserDto } from './dto/create-users.dto';
import { UpdateUserDto } from './dto/update-users.dto';
import { UsersRepository } from './users.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import { SetupAccountDto } from './dto/setup-account.dto';
import { AuthService } from '../auth/auth.service';
import {
  FileStorageService,
  StoredFile,
  UploadFileInput,
} from '../file-storage/file-storage.service';
import { AppException, ErrorCode } from '../../common/errors';
import { AppUser, Waitlist } from '@prisma/client';
import { PaymentMethodValidatorService } from '../payment-methods/payment-method-validator.service';
import { USER_PUBLIC_SELECT, PublicUser } from '../../common/prisma-selects';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction, AuditResult } from '../audit-log/enums/audit-action.enum';
import { validatePaymentProviderMetadata } from '../payment-providers/payment-provider-metadata.validator';

export interface AliasAvailability {
  available: boolean;
}

export interface SetupAccountResult {
  user: AppUser;
  access_token: string;
}

export interface UploadResult {
  userId: string;
  profileImageUrl: string;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly repo: UsersRepository,
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly fileStorageService: FileStorageService,
    private readonly paymentMethodValidator: PaymentMethodValidatorService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async getOrCreateAccount(publicKey: string): Promise<AppUser> {
    return this.repo.findOrCreateByPublicKey(publicKey);
  }

  async earlyRegister(email: string): Promise<Waitlist> {
    if (!email) {
      throw new AppException(ErrorCode.MISSING_EMAIL, 'Email is required');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new AppException(ErrorCode.INVALID_EMAIL, 'Invalid email format');
    }

    return this.prisma.waitlist.upsert({
      where: { email },
      update: {},
      create: { email },
    });
  }

  async isAliasAvailable(alias: string): Promise<AliasAvailability> {
    const available = await this.repo.isAliasAvailable(alias);
    return { available };
  }

  async setupAccount(
    userId: string,
    dto: SetupAccountDto,
  ): Promise<SetupAccountResult> {
    const {
      bankName,
      accountHolderName,
      accountNumber,
      providerId,
      accountIdentifier,
      identificationNumber,
      beneficiaryName,
      description,
      ...profileData
    } = dto;

    const updatedUser: AppUser = (await this.repo.update(userId, {
      ...(profileData as unknown as Record<string, unknown>),
      pendingAccountInfo: false,
    })) as AppUser;

    void bankName;
    void accountHolderName;
    void accountNumber;

    if (providerId && accountIdentifier) {
      const provider = await this.prisma.payment_provider.findUnique({
        where: { provider_id: providerId },
      });

      if (!provider) {
        throw new AppException(
          ErrorCode.PAYMENT_PROVIDER_NOT_FOUND,
          'Payment provider not found',
        );
      }

      validatePaymentProviderMetadata(provider.type, provider.metadata);

      this.paymentMethodValidator.validate(
        {
          type: provider.type,
          countryCode: provider.country_code,
          code: (provider.metadata as { code?: string } | null | undefined)
            ?.code,
        },
        accountIdentifier,
      );

      await this.prisma.paymentMethod.create({
        data: {
          userId,
          providerId,
          type: provider.type,
          accountIdentifier,
          identificationNumber,
          beneficiaryName,
          description,
        },
      });
    }

    const { access_token } = await Promise.resolve(
      this.authService.finalizeSetup(userId, updatedUser.publicKey),
    );

    return { user: updatedUser, access_token };
  }

  async create(dto: CreateUserDto): Promise<AppUser> {
    const exists = await this.repo.findByPublicKey(dto.publicKey);
    if (exists) {
      throw new AppException(
        ErrorCode.USER_ALREADY_EXISTS,
        'A user with this public key already exists',
      );
    }
    return this.repo.create(
      dto as unknown as Record<string, unknown>,
    ) as Promise<AppUser>;
  }

  list(p: PaginationDto): Promise<PublicUser[]> {
    return this.repo.findMany({
      skip: p.skip,
      take: p.take,
      orderBy: { createdAt: 'desc' },
      select: USER_PUBLIC_SELECT,
    }) as Promise<PublicUser[]>;
  }

  async findByPublicKey(publicKey: string): Promise<AppUser | null> {
    return this.repo.findByPublicKey(publicKey);
  }

  async get(id: string): Promise<AppUser> {
    const item = (await this.repo.findById(id)) as AppUser | null;
    if (!item) {
      throw new AppException(ErrorCode.USER_NOT_FOUND, `User ${id} not found`);
    }
    return item;
  }

  async update(
    id: string,
    dto: UpdateUserDto,
    callerUserId?: string,
  ): Promise<AppUser> {
    if (callerUserId && callerUserId !== id) {
      throw new AppException(
        ErrorCode.UNAUTHORIZED_ACTION,
        'You can only update your own profile.',
      );
    }

    if (dto.alias) {
      const user = (await this.repo.findById(id)) as AppUser | null;
      if (!user) {
        throw new AppException(
          ErrorCode.USER_NOT_FOUND,
          `User ${id} not found`,
        );
      }
      if (user.alias !== dto.alias) {
        const isAvailable = await this.repo.isAliasAvailable(dto.alias);
        if (!isAvailable) {
          throw new AppException(
            ErrorCode.ALIAS_TAKEN,
            'Alias is already taken',
          );
        }
      }
    }

    const data: Record<string, unknown> = { ...dto };
    if (dto.kycStatus) data.kycUpdatedAt = new Date();
    return this.repo.update(id, data) as Promise<AppUser>;
  }

  async uploadProfilePicture(
    id: string,
    file: UploadFileInput,
    userSnapshot?: Record<string, unknown>,
  ): Promise<AppUser | UploadResult> {
    if (process.env.MOCK_PROFILE_UPLOAD === 'true') {
      const uploadedFile: StoredFile =
        await this.fileStorageService.uploadFile(file);
      return {
        ...(userSnapshot ?? {}),
        userId: id,
        profileImageUrl: uploadedFile.url,
      };
    }

    const user = (await this.repo.findById(id)) as AppUser | null;
    if (!user) {
      throw new AppException(ErrorCode.USER_NOT_FOUND, `User ${id} not found`);
    }

    const uploadedFile: StoredFile =
      await this.fileStorageService.uploadFile(file);
    return this.repo.update(id, {
      profileImageUrl: uploadedFile.url,
    }) as Promise<AppUser>;
  }

  /**
   * Returns the caller's own personal data footprint: profile fields plus
   * everything linked to them (payment methods, audit logs, offers,
   * orders, chat messages, and a matching waitlist entry if any).
   */
  async exportUserData(
    id: string,
    callerUserId?: string,
  ): Promise<Record<string, unknown>> {
    if (!callerUserId || callerUserId !== id) {
      throw new AppException(
        ErrorCode.UNAUTHORIZED_ACTION,
        'You can only export your own data.',
      );
    }

    const user = await this.repo.findExportData(id);
    if (!user) {
      throw new AppException(ErrorCode.USER_NOT_FOUND, `User ${id} not found`);
    }

    const waitlist = user.email
      ? await this.prisma.waitlist.findUnique({ where: { email: user.email } })
      : null;

    await this.auditLogService.create({
      action: AuditAction.USER_DATA_EXPORTED,
      resourceType: 'User',
      resourceId: id,
      result: AuditResult.SUCCESS,
    });

    return { ...user, waitlist };
  }

  /**
   * Erases/anonymizes the caller's PII instead of hard-deleting the
   * AppUser row, so historical orders/offers/escrows the account is party
   * to stay intact and no FK constraint is violated. Payment methods are
   * removed outright, sent chat message content is scrubbed, audit log
   * entries lose their IP/user-agent, and a matching waitlist row (if any)
   * is removed. Idempotent: re-running on an already-deleted account is a
   * safe no-op past the first call.
   */
  async remove(id: string, callerUserId?: string): Promise<AppUser> {
    if (!callerUserId || callerUserId !== id) {
      throw new AppException(
        ErrorCode.UNAUTHORIZED_ACTION,
        'You can only delete your own account.',
      );
    }

    const anonymized = await this.prisma.$transaction(async (tx) => {
      const user = await tx.appUser.findUnique({
        where: { userId: id },
      });
      if (!user) {
        throw new AppException(
          ErrorCode.USER_NOT_FOUND,
          `User ${id} not found`,
        );
      }

      await tx.paymentMethod.deleteMany({ where: { userId: id } });
      await tx.chatMessage.updateMany({
        where: { senderId: id },
        data: { content: '[deleted]' },
      });
      await tx.auditLog.updateMany({
        where: { userId: id },
        data: { ipAddress: null, userAgent: null },
      });
      if (user.email) {
        await tx.waitlist.deleteMany({ where: { email: user.email } });
      }
      return tx.appUser.update({
        where: { userId: id },
        data: {
          email: null,
          username: null,
          alias: null,
          bio: null,
          profileImageUrl: null,
          currentNonce: null,
          preferredCurrency: null,
          deletedAt: new Date(),
        },
      });
    });

    await this.auditLogService.create({
      action: AuditAction.USER_DATA_DELETED,
      resourceType: 'User',
      resourceId: id,
      result: AuditResult.SUCCESS,
    });

    return anonymized;
  }
}
