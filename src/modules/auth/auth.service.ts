import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { AppUser } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { AppException, ErrorCode } from '../../common/errors';
import { CreateAuthChallengeDto } from './dto/create-auth-challenge.dto';
import { LoginDto } from './dto/login.dto';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction, AuditResult } from '../audit-log/enums/audit-action.enum';

export interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
  correlationId?: string;
}

export interface AuthChallengeResponse {
  challenge: string;
  expiresAt: string;
}

const DEFAULT_CHALLENGE_EXPIRATION_SECONDS = 300;
const AUTH_TOKEN_TTL_MS = 60 * 60 * 1000;

const ED25519_SIGNATURE_LENGTH = 64;

const SEP_53_PREFIX = Buffer.from('Stellar Signed Message:\n', 'utf8');

const BASE64_REGEX =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /**
   * Step 1 of wallet authentication: issues a short-lived, cryptographically
   * random challenge that the client must sign with the wallet's secret key.
   * Any previous active challenge for the same public key is replaced.
   */
  async createChallenge(
    dto: CreateAuthChallengeDto,
  ): Promise<AuthChallengeResponse> {
    const { publicKey } = dto;
    this.assertValidPublicKey(publicKey);

    const challenge = randomBytes(32).toString('hex');
    const expiresAt = new Date(
      Date.now() + this.getChallengeExpirationSeconds() * 1000,
    );

    await this.prisma.authChallenge.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });

    await this.prisma.authChallenge.upsert({
      where: { publicKey },
      create: { publicKey, challenge, expiresAt },
      update: { challenge, expiresAt, usedAt: null, createdAt: new Date() },
    });

    return { challenge, expiresAt: expiresAt.toISOString() };
  }

  /**
   * Step 2 of wallet authentication: verifies the signed challenge and issues
   * a temporary JWT only if the signature proves ownership of the wallet.
   * Records USER_LOGIN_SUCCESS / USER_LOGIN_FAILURE audit events.
   */
  async login(
    dto: LoginDto,
    ctx: RequestContext = {},
  ): Promise<{ access_token: string; user: AppUser }> {
    const { publicKey, challenge, signature } = dto;
    this.assertValidPublicKey(publicKey);

    const stored = await this.prisma.authChallenge.findUnique({
      where: { publicKey },
    });

    if (
      !stored ||
      stored.usedAt !== null ||
      stored.expiresAt.getTime() <= Date.now() ||
      stored.challenge !== challenge
    ) {
      await this.recordLoginFailure(
        publicKey,
        ctx,
        'invalid_or_expired_challenge',
      );
      throw new AppException(
        ErrorCode.INVALID_CHALLENGE,
        'Challenge is invalid or has expired',
      );
    }

    const signatureBytes = this.decodeSignature(signature);

    let isValidSignature = false;
    try {
      const keypair = Keypair.fromPublicKey(publicKey);
      const challengeBytes = Buffer.from(challenge, 'utf8');
      const sep53Hash = createHash('sha256')
        .update(Buffer.concat([SEP_53_PREFIX, challengeBytes]))
        .digest();

      // Freighter and Stellar CLI sign the SEP-53 hash. Keep raw challenge
      // verification for compatibility with clients that sign bytes directly.
      isValidSignature =
        keypair.verify(sep53Hash, signatureBytes) ||
        keypair.verify(challengeBytes, signatureBytes);
    } catch (error) {
      this.logger.warn(
        `Signature verification threw: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      isValidSignature = false;
    }

    if (!isValidSignature) {
      await this.recordLoginFailure(publicKey, ctx, 'invalid_signature');
      throw new AppException(
        ErrorCode.INVALID_SIGNATURE,
        'Signature verification failed',
      );
    }

    const consumed = await this.prisma.authChallenge.updateMany({
      where: {
        publicKey,
        challenge,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { usedAt: new Date() },
    });

    if (consumed.count === 0) {
      await this.recordLoginFailure(publicKey, ctx, 'challenge_race_condition');
      throw new AppException(
        ErrorCode.INVALID_CHALLENGE,
        'Challenge is invalid or has expired',
      );
    }

    const user = await this.prisma.appUser.upsert({
      where: { publicKey },
      create: { publicKey },
      update: {},
    });

    await this.auditLogService.create({
      action: AuditAction.USER_LOGIN_SUCCESS,
      resourceType: 'User',
      resourceId: publicKey,
      result: AuditResult.SUCCESS,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      correlationId: ctx.correlationId,
    });

    return {
      access_token: await this.createSessionToken(user.userId, publicKey),
      user,
    };
  }

  /**
   * Generates a definitive JWT after the user has completed their profile setup.
   */
  async finalizeSetup(
    userId: string,
    publicKey: string,
  ): Promise<{ access_token: string }> {
    return {
      access_token: await this.createSessionToken(userId, publicKey, true),
    };
  }

  /** Revokes only the authenticated JWT session, leaving other devices active. */
  async revokeSession(
    userId: string,
    sessionId?: string,
  ): Promise<{ revoked: boolean }> {
    if (!sessionId) {
      throw new UnauthorizedException(
        'This token does not support session revocation; sign in again',
      );
    }

    const result = await this.prisma.authSession.updateMany({
      where: { sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return { revoked: result.count > 0 };
  }

  private async createSessionToken(
    userId: string,
    publicKey: string,
    setupComplete = false,
  ): Promise<string> {
    const sessionId = randomUUID();
    await this.prisma.authSession.create({
      data: {
        sessionId,
        userId,
        expiresAt: new Date(Date.now() + AUTH_TOKEN_TTL_MS),
      },
    });

    const payload: {
      sub: string;
      publicKey: string;
      setupComplete?: boolean;
    } = { sub: userId, publicKey };
    if (setupComplete) payload.setupComplete = true;

    return this.jwtService.sign(payload, { jwtid: sessionId });
  }

  private async recordLoginFailure(
    publicKey: string,
    ctx: RequestContext,
    reason: string,
  ): Promise<void> {
    await this.auditLogService.create({
      action: AuditAction.USER_LOGIN_FAILURE,
      resourceType: 'User',
      resourceId: publicKey,
      result: AuditResult.FAILURE,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      correlationId: ctx.correlationId,
      metadata: { reason },
    });
  }

  private assertValidPublicKey(publicKey: string): void {
    if (!StrKey.isValidEd25519PublicKey(publicKey)) {
      throw new AppException(
        ErrorCode.INVALID_WALLET,
        'Invalid Stellar public key',
      );
    }
  }

  private decodeSignature(signature: string): Buffer {
    if (!BASE64_REGEX.test(signature)) {
      throw new AppException(
        ErrorCode.INVALID_SIGNATURE,
        'Signature must be valid Base64',
      );
    }
    const decoded = Buffer.from(signature, 'base64');
    if (decoded.length !== ED25519_SIGNATURE_LENGTH) {
      throw new AppException(
        ErrorCode.INVALID_SIGNATURE,
        'Signature verification failed',
      );
    }
    return decoded;
  }

  private getChallengeExpirationSeconds(): number {
    const raw = this.config.get<string>('AUTH_CHALLENGE_EXPIRATION_SECONDS');
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_CHALLENGE_EXPIRATION_SECONDS;
    }
    return Math.floor(parsed);
  }

  async purgeExpiredChallenges(
    retentionHours = 24,
  ): Promise<{ count: number }> {
    const now = new Date();
    const usedThreshold = new Date(
      now.getTime() - retentionHours * 60 * 60 * 1000,
    );

    const result = await this.prisma.authChallenge.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: now } },
          {
            AND: [{ usedAt: { not: null } }, { usedAt: { lt: usedThreshold } }],
          },
        ],
      },
    });

    this.logger.log(`Purged ${result.count} expired/stale auth challenges`);
    return result;
  }
}
