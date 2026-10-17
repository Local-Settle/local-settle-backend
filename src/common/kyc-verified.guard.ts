import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppException, ErrorCode } from './errors';

interface RequestWithUser {
  user?: { publicKey?: string };
}

@Injectable()
export class KycVerifiedGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const userPayload = request.user;

    if (!userPayload || !userPayload.publicKey) {
      throw new AppException(
        ErrorCode.UNAUTHORIZED_ACTION,
        'Authentication required',
      );
    }

    const user = await this.prisma.appUser.findUnique({
      where: { publicKey: userPayload.publicKey, deletedAt: null },
      select: { kycStatus: true },
    });

    if (!user || user.kycStatus !== 'approved') {
      throw new AppException(
        ErrorCode.KYC_REQUIRED,
        'KYC verification required to perform this action',
      );
    }

    return true;
  }
}
