import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { HttpStatus } from '@nestjs/common';
import { Keypair } from '@stellar/stellar-sdk';
import { createHash } from 'crypto';
import { AuthService } from './auth.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AppException, ErrorCode } from '../../common/errors';
import { AuditLogService } from '../audit-log/audit-log.service';

interface StoredChallenge {
  challengeId: string;
  publicKey: string;
  challenge: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

describe('AuthService', () => {
  let service: AuthService;

  const prismaMock = {
    authChallenge: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    appUser: {
      upsert: jest.fn(),
    },
    authSession: {
      create: jest.fn().mockResolvedValue(undefined),
      updateMany: jest.fn(),
    },
  };

  const jwtMock = { sign: jest.fn().mockReturnValue('signed-jwt') };
  const configMock = { get: jest.fn() };
  const auditLogMock = { create: jest.fn().mockResolvedValue(undefined) };

  const keypair = Keypair.random();
  const publicKey = keypair.publicKey();

  const provisionedUser = { userId: 'user-1', publicKey };

  const buildStored = (
    overrides: Partial<StoredChallenge> = {},
  ): StoredChallenge => ({
    challengeId: 'challenge-id',
    publicKey,
    challenge: 'a'.repeat(64),
    expiresAt: new Date(Date.now() + 60_000),
    usedAt: null,
    createdAt: new Date(),
    ...overrides,
  });

  const signChallenge = (challenge: string, signer: Keypair = keypair) =>
    signer.sign(Buffer.from(challenge, 'utf8')).toString('base64');

  const signSep53Challenge = (challenge: string, signer: Keypair = keypair) => {
    const payload = Buffer.concat([
      Buffer.from('Stellar Signed Message:\n', 'utf8'),
      Buffer.from(challenge, 'utf8'),
    ]);
    return signer
      .sign(createHash('sha256').update(payload).digest())
      .toString('base64');
  };

  const expectAppException = async (
    promise: Promise<unknown>,
    errorCode: ErrorCode,
    status: HttpStatus,
  ) => {
    let caught: unknown;
    try {
      await promise;
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppException);
    const exception = caught as AppException;
    expect(exception.getStatus()).toBe(status);
    expect((exception.getResponse() as { error: ErrorCode }).error).toBe(
      errorCode,
    );
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    configMock.get.mockReturnValue(undefined);
    prismaMock.authChallenge.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.authChallenge.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.appUser.upsert.mockResolvedValue(provisionedUser);
    prismaMock.authSession.create.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: JwtService, useValue: jwtMock },
        { provide: ConfigService, useValue: configMock },
        { provide: AuditLogService, useValue: auditLogMock },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  describe('createChallenge', () => {
    it('rejects an invalid Stellar public key', async () => {
      await expectAppException(
        service.createChallenge({ publicKey: 'not-a-stellar-key' }),
        ErrorCode.INVALID_WALLET,
        HttpStatus.BAD_REQUEST,
      );
      expect(prismaMock.authChallenge.upsert).not.toHaveBeenCalled();
    });

    it('generates a 32-byte hex challenge and stores it with an expiry', async () => {
      const before = Date.now();
      const result = await service.createChallenge({ publicKey });

      expect(result.challenge).toMatch(/^[0-9a-f]{64}$/);
      const expiresAt = new Date(result.expiresAt).getTime();
      // default expiration is 300 seconds
      expect(expiresAt).toBeGreaterThanOrEqual(before + 299_000);
      expect(expiresAt).toBeLessThanOrEqual(Date.now() + 301_000);

      expect(prismaMock.authChallenge.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { publicKey },
          create: expect.objectContaining({
            publicKey,
            challenge: result.challenge,
          }) as Record<string, unknown>,
        }),
      );
    });

    it('replaces any previous challenge and clears usedAt', async () => {
      await service.createChallenge({ publicKey });

      const upsertArgs = (
        prismaMock.authChallenge.upsert.mock.calls as [
          [Record<string, Record<string, unknown>>],
        ]
      )[0][0];
      expect(upsertArgs.update.usedAt).toBeNull();
      expect(upsertArgs.update.challenge).toMatch(/^[0-9a-f]{64}$/);
    });

    it('purges expired challenges before storing a new one', async () => {
      await service.createChallenge({ publicKey });

      expect(prismaMock.authChallenge.deleteMany).toHaveBeenCalledWith({
        where: { expiresAt: { lt: expect.any(Date) as Date } },
      });
    });

    it('generates a different challenge on every call', async () => {
      const first = await service.createChallenge({ publicKey });
      const second = await service.createChallenge({ publicKey });
      expect(first.challenge).not.toBe(second.challenge);
    });

    it('honours AUTH_CHALLENGE_EXPIRATION_SECONDS', async () => {
      configMock.get.mockReturnValue('60');
      const before = Date.now();
      const result = await service.createChallenge({ publicKey });
      const expiresAt = new Date(result.expiresAt).getTime();
      expect(expiresAt).toBeGreaterThanOrEqual(before + 59_000);
      expect(expiresAt).toBeLessThanOrEqual(Date.now() + 61_000);
    });
  });

  describe('login', () => {
    it('issues a JWT for a SEP-53 wallet signature', async () => {
      const stored = buildStored();
      prismaMock.authChallenge.findUnique.mockResolvedValue(stored);

      const result = await service.login({
        publicKey,
        challenge: stored.challenge,
        signature: signSep53Challenge(stored.challenge),
      });

      expect(result).toEqual({
        access_token: 'signed-jwt',
        user: provisionedUser,
      });
    });

    it('issues a JWT for a correctly signed challenge', async () => {
      const stored = buildStored();
      prismaMock.authChallenge.findUnique.mockResolvedValue(stored);

      const result = await service.login({
        publicKey,
        challenge: stored.challenge,
        signature: signChallenge(stored.challenge),
      });

      expect(result).toEqual({
        access_token: 'signed-jwt',
        user: provisionedUser,
      });
      expect(prismaMock.appUser.upsert).toHaveBeenCalledWith({
        where: { publicKey },
        create: { publicKey },
        update: {},
      });
      expect(jwtMock.sign).toHaveBeenCalledWith(
        {
          sub: provisionedUser.userId,
          publicKey,
        },
        { jwtid: expect.any(String) as string },
      );
      expect(prismaMock.authSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: provisionedUser.userId,
          expiresAt: expect.any(Date) as Date,
        }),
      });
      expect(prismaMock.authChallenge.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            publicKey,
            challenge: stored.challenge,
            usedAt: null,
          }) as Record<string, unknown>,
          data: { usedAt: expect.any(Date) as Date },
        }),
      );
    });

    it('rejects an invalid Stellar public key', async () => {
      await expectAppException(
        service.login({
          publicKey: 'bad-key',
          challenge: 'x',
          signature: signChallenge('x'),
        }),
        ErrorCode.INVALID_WALLET,
        HttpStatus.BAD_REQUEST,
      );
    });

    it('rejects an unknown challenge with 401', async () => {
      prismaMock.authChallenge.findUnique.mockResolvedValue(null);

      await expectAppException(
        service.login({
          publicKey,
          challenge: 'a'.repeat(64),
          signature: signChallenge('a'.repeat(64)),
        }),
        ErrorCode.INVALID_CHALLENGE,
        HttpStatus.UNAUTHORIZED,
      );
    });

    it('rejects an expired challenge with 401', async () => {
      const stored = buildStored({ expiresAt: new Date(Date.now() - 1_000) });
      prismaMock.authChallenge.findUnique.mockResolvedValue(stored);

      await expectAppException(
        service.login({
          publicKey,
          challenge: stored.challenge,
          signature: signChallenge(stored.challenge),
        }),
        ErrorCode.INVALID_CHALLENGE,
        HttpStatus.UNAUTHORIZED,
      );
    });

    it('rejects an already used challenge with 401', async () => {
      const stored = buildStored({ usedAt: new Date() });
      prismaMock.authChallenge.findUnique.mockResolvedValue(stored);

      await expectAppException(
        service.login({
          publicKey,
          challenge: stored.challenge,
          signature: signChallenge(stored.challenge),
        }),
        ErrorCode.INVALID_CHALLENGE,
        HttpStatus.UNAUTHORIZED,
      );
    });

    it('rejects a challenge that does not match the stored value', async () => {
      const stored = buildStored();
      prismaMock.authChallenge.findUnique.mockResolvedValue(stored);

      const other = 'b'.repeat(64);
      await expectAppException(
        service.login({
          publicKey,
          challenge: other,
          signature: signChallenge(other),
        }),
        ErrorCode.INVALID_CHALLENGE,
        HttpStatus.UNAUTHORIZED,
      );
    });

    it('rejects a malformed Base64 signature with 401', async () => {
      const stored = buildStored();
      prismaMock.authChallenge.findUnique.mockResolvedValue(stored);

      await expectAppException(
        service.login({
          publicKey,
          challenge: stored.challenge,
          signature: '!!!not-base64!!!',
        }),
        ErrorCode.INVALID_SIGNATURE,
        HttpStatus.UNAUTHORIZED,
      );
      expect(prismaMock.authChallenge.updateMany).not.toHaveBeenCalled();
    });

    it('rejects a valid-Base64 signature of the wrong length', async () => {
      const stored = buildStored();
      prismaMock.authChallenge.findUnique.mockResolvedValue(stored);

      await expectAppException(
        service.login({
          publicKey,
          challenge: stored.challenge,
          signature: Buffer.from('too short').toString('base64'),
        }),
        ErrorCode.INVALID_SIGNATURE,
        HttpStatus.UNAUTHORIZED,
      );
    });

    it('rejects a signature made by a different wallet', async () => {
      const stored = buildStored();
      prismaMock.authChallenge.findUnique.mockResolvedValue(stored);

      await expectAppException(
        service.login({
          publicKey,
          challenge: stored.challenge,
          signature: signChallenge(stored.challenge, Keypair.random()),
        }),
        ErrorCode.INVALID_SIGNATURE,
        HttpStatus.UNAUTHORIZED,
      );
      expect(jwtMock.sign).not.toHaveBeenCalled();
    });

    it('rejects when the challenge was consumed concurrently', async () => {
      const stored = buildStored();
      prismaMock.authChallenge.findUnique.mockResolvedValue(stored);
      prismaMock.authChallenge.updateMany.mockResolvedValue({ count: 0 });

      await expectAppException(
        service.login({
          publicKey,
          challenge: stored.challenge,
          signature: signChallenge(stored.challenge),
        }),
        ErrorCode.INVALID_CHALLENGE,
        HttpStatus.UNAUTHORIZED,
      );
      expect(jwtMock.sign).not.toHaveBeenCalled();
    });
  });

  describe('finalizeSetup', () => {
    it('signs a definitive JWT with setupComplete and creates a session', async () => {
      const result = await service.finalizeSetup('user-1', publicKey);
      expect(result).toEqual({ access_token: 'signed-jwt' });
      expect(jwtMock.sign).toHaveBeenCalledWith(
        {
          sub: 'user-1',
          publicKey,
          setupComplete: true,
        },
        { jwtid: expect.any(String) as string },
      );
      expect(prismaMock.authSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          sessionId: expect.any(String) as string,
          userId: 'user-1',
          expiresAt: expect.any(Date) as Date,
        }),
      });
    });
  });

  describe('revokeSession', () => {
    it('revokes only the requested session belonging to the user', async () => {
      prismaMock.authSession.updateMany.mockResolvedValue({ count: 1 });

      await expect(
        service.revokeSession('user-1', 'session-1'),
      ).resolves.toEqual({ revoked: true });
      expect(prismaMock.authSession.updateMany).toHaveBeenCalledWith({
        where: { sessionId: 'session-1', userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) as Date },
      });
    });

    it('requires a session identifier for revocation', async () => {
      await expect(service.revokeSession('user-1')).rejects.toThrow(
        'This token does not support session revocation; sign in again',
      );
      expect(prismaMock.authSession.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('purgeExpiredChallenges', () => {
    it('deletes expired challenges and used challenges older than retention threshold', async () => {
      prismaMock.authChallenge.deleteMany.mockResolvedValueOnce({ count: 7 });

      const res = await service.purgeExpiredChallenges(24);

      expect(res).toEqual({ count: 7 });
      expect(prismaMock.authChallenge.deleteMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { expiresAt: { lt: expect.any(Date) as unknown as Date } },
            {
              AND: [
                { usedAt: { not: null } },
                { usedAt: { lt: expect.any(Date) as unknown as Date } },
              ],
            },
          ],
        },
      });
    });
  });
});
