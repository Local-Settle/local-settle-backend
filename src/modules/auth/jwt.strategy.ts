import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../prisma/prisma.service';
import { AppException, ErrorCode } from '../../common/errors';
import { getJwtSecret } from '../../config/jwt.config';

interface JwtPayload {
  sub: string;
  publicKey: string;
  setupComplete?: boolean;
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
  ): Promise<{ userId: string; publicKey: string; setupComplete?: boolean }> {
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

    return {
      userId,
      publicKey: payload.publicKey,
      setupComplete: payload.setupComplete,
    };
  }
}
