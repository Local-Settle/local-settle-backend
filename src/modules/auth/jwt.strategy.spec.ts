import { UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy session validation', () => {
  const previousSecret = process.env.JWT_SECRET;
  const sessions = new Map<string, { userId: string; revokedAt: Date | null }>([
    ['session-1', { userId: 'user-1', revokedAt: null }],
    ['session-2', { userId: 'user-1', revokedAt: null }],
  ]);
  const prismaMock = {
    authSession: {
      findFirst: jest.fn(
        async ({
          where,
        }: {
          where: { sessionId: string; userId: string };
        }) => {
          const session = sessions.get(where.sessionId);
          return session && session.userId === where.userId && !session.revokedAt
            ? { sessionId: where.sessionId }
            : null;
        },
      ),
    },
    appUser: { findUnique: jest.fn() },
  };

  let strategy: JwtStrategy;

  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters';
    strategy = new JwtStrategy(prismaMock as unknown as PrismaService);
  });

  afterAll(() => {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  });

  it('accepts active sessions and keeps each token session-scoped', async () => {
    await expect(
      strategy.validate({
        sub: 'user-1',
        publicKey: 'GTEST',
        jti: 'session-1',
      }),
    ).resolves.toMatchObject({ userId: 'user-1', sessionId: 'session-1' });
  });

  it('rejects a revoked token while an unaffected session remains valid', async () => {
    sessions.set('session-1', {
      userId: 'user-1',
      revokedAt: new Date(),
    });

    await expect(
      strategy.validate({
        sub: 'user-1',
        publicKey: 'GTEST',
        jti: 'session-1',
      }),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      strategy.validate({
        sub: 'user-1',
        publicKey: 'GTEST',
        jti: 'session-2',
      }),
    ).resolves.toMatchObject({ userId: 'user-1', sessionId: 'session-2' });
  });
});
