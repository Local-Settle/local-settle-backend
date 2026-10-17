import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../../prisma/prisma.service';
import { AppException, ErrorCode } from '../errors';
import { RESOURCE_OWNER_KEY } from '../decorators/resource-owner.decorator';
import {
  ResourceOwnerMetadata,
  ResourceType,
} from '../interfaces/resource-owner.interface';
import { AuthenticatedRequest } from '../../lib/types/auth';
import { PRIVILEGED_ROLES } from '../constants/roles';

const NOT_FOUND_ERROR_BY_TYPE: Record<ResourceType, ErrorCode> = {
  [ResourceType.ORDER]: ErrorCode.ORDER_NOT_FOUND,
  [ResourceType.ESCROW]: ErrorCode.ESCROW_NOT_FOUND,
  [ResourceType.CHAT_MESSAGE]: ErrorCode.CHAT_MESSAGE_NOT_FOUND,
  [ResourceType.PAYMENT_METHOD]: ErrorCode.PAYMENT_METHOD_NOT_FOUND,
};

@Injectable()
export class ResourceOwnerGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const metadata = this.reflector.get<ResourceOwnerMetadata | undefined>(
      RESOURCE_OWNER_KEY,
      context.getHandler(),
    );

    if (!metadata) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = request.user?.userId ?? request.user?.id;

    if (!userId) {
      throw new AppException(
        ErrorCode.UNAUTHORIZED_ACTION,
        'Authentication required',
      );
    }

    const rawResourceId =
      request.params?.[metadata.paramKey] ??
      (request.body as Record<string, unknown> | undefined)?.[
        metadata.paramKey
      ];
    const resourceId = Array.isArray(rawResourceId)
      ? rawResourceId[0]
      : rawResourceId;
    if (!resourceId) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        `Missing required parameter: ${metadata.paramKey}`,
      );
    }

    const requester = await this.prisma.appUser.findUnique({
      where: { userId },
      select: { role: true, publicKey: true },
    });

    if (
      requester &&
      request.user?.publicKey &&
      requester.publicKey !== request.user.publicKey
    ) {
      throw new AppException(
        ErrorCode.UNAUTHORIZED_ACTION,
        'Authenticated wallet does not match the user account.',
      );
    }

    if (requester && PRIVILEGED_ROLES.has(requester.role)) {
      return true;
    }

    const ownerIds = await this.resolveOwnerIds(metadata.type, resourceId);

    if (ownerIds === null) {
      throw new AppException(
        NOT_FOUND_ERROR_BY_TYPE[metadata.type],
        'Resource not found',
      );
    }

    if (!ownerIds.includes(userId)) {
      throw new AppException(
        ErrorCode.UNAUTHORIZED_ACTION,
        'You do not have access to this resource',
      );
    }

    await this.validateEscrowParticipantFields(
      metadata.type,
      resourceId,
      request.user?.publicKey,
      (request.body ?? {}) as Record<string, unknown>,
    );

    return true;
  }

  private async validateEscrowParticipantFields(
    type: ResourceType,
    resourceId: string,
    publicKey: string | undefined,
    body: Record<string, unknown>,
  ): Promise<void> {
    if (type === ResourceType.ORDER && body.buyerAddress && body.sellerAddress) {
      const order = await this.prisma.order.findUnique({
        where: { orderId: resourceId },
        select: {
          buyer: { select: { publicKey: true } },
          seller: { select: { publicKey: true } },
        },
      });
      if (
        !order ||
        body.buyerAddress !== order.buyer.publicKey ||
        body.sellerAddress !== order.seller.publicKey
      ) {
        throw new AppException(
          ErrorCode.UNAUTHORIZED_ACTION,
          'Escrow participant addresses must match the order.',
        );
      }
    }

    if (type !== ResourceType.ESCROW) return;
    const signerField =
      typeof body.signerAddress === 'string'
        ? body.signerAddress
        : typeof body.releaseSigner === 'string'
          ? body.releaseSigner
          : undefined;
    if (!signerField) return;

    const escrow = await this.prisma.escrowOnChain.findUnique({
      where: { escrowId: resourceId },
      select: { buyerAddress: true, sellerAddress: true },
    });
    if (
      !escrow ||
      !publicKey ||
      signerField !== publicKey ||
      signerField !== escrow.sellerAddress
    ) {
      throw new AppException(
        ErrorCode.UNAUTHORIZED_ACTION,
        'Only the escrow seller may submit this signer address.',
      );
    }
  }

  private async resolveOwnerIds(
    type: ResourceType,
    resourceId: string,
  ): Promise<string[] | null> {
    switch (type) {
      case ResourceType.ORDER: {
        const order = await this.prisma.order.findUnique({
          where: { orderId: resourceId },
          select: { buyerId: true, sellerId: true },
        });
        return order ? [order.buyerId, order.sellerId] : null;
      }

      case ResourceType.ESCROW: {
        const escrow = await this.prisma.escrowOnChain.findUnique({
          where: { escrowId: resourceId },
          select: { order: { select: { buyerId: true, sellerId: true } } },
        });
        return escrow ? [escrow.order.buyerId, escrow.order.sellerId] : null;
      }

      case ResourceType.CHAT_MESSAGE: {
        const message = await this.prisma.chatMessage.findUnique({
          where: { messageId: resourceId },
          select: {
            senderId: true,
            order: { select: { buyerId: true, sellerId: true } },
          },
        });
        return message
          ? [message.senderId, message.order.buyerId, message.order.sellerId]
          : null;
      }

      case ResourceType.PAYMENT_METHOD: {
        const paymentMethod = await this.prisma.paymentMethod.findUnique({
          where: { paymentId: resourceId },
          select: { userId: true },
        });
        return paymentMethod ? [paymentMethod.userId] : null;
      }

      default: {
        const exhaustiveCheck: never = type;
        throw new Error(
          `Unsupported resource type: ${String(exhaustiveCheck)}`,
        );
      }
    }
  }
}
