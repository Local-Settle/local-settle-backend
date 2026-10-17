import { order_status } from '@prisma/client';

export const ORDER_STATUS = {
  CREATED: 'created' as order_status,
  LOCKED: 'locked' as order_status,
  RELEASED: 'released' as order_status,
  CANCELLED: 'cancelled' as order_status,
  EXPIRED: 'expired' as order_status,
  DISPUTED: 'disputed' as order_status,
} as const;

/**
 * Status changes accepted by the generic order PATCH endpoint. Changes that
 * cancel, expire, release, or dispute an order must come from their dedicated
 * cancellation/expiration or on-chain event flows.
 */
export const PATCHABLE_ORDER_TRANSITIONS: Readonly<
  Partial<Record<order_status, readonly order_status[]>>
> = {
  [ORDER_STATUS.CREATED]: [ORDER_STATUS.LOCKED],
  [ORDER_STATUS.LOCKED]: [ORDER_STATUS.RELEASED, ORDER_STATUS.DISPUTED],
};
