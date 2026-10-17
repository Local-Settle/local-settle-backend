import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../prisma/prisma.service';
import { AppException, ErrorCode } from '../../common/errors';
import { getJwtSecret } from '../../config/jwt.config';

interface JwtPayload {
  sub: string;
  publicKey: string;
  jti?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getJwtSecret(),
    });
  }

  async validate(
    payload: JwtPayload,
  ): Promise<{ userId: string; publicKey: string; sessionId?: string }> {
    let userId = payload.sub;

    // Fallback for legacy tokens where sub was the wallet address
    if (userId.startsWith('G') && userId.length === 56) {
      const user = await this.prisma.appUser.findUnique({
        where: { publicKey: userId },
      });
      if (user) {
        userId = user.userId;
      } else {
        throw new AppException(ErrorCode.USER_NOT_FOUND, 'User not found');
      }
    }

    if (payload.jti) {
      const session = await this.prisma.authSession.findFirst({
        where: {
          sessionId: payload.jti,
          userId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: { sessionId: true },
      });

      if (!session) {
        throw new UnauthorizedException(
          'Session is invalid or has been revoked',
        );
      }
    }

    return {
      userId,
      publicKey: payload.publicKey,
      sessionId: payload.jti,
    };
  }
}
