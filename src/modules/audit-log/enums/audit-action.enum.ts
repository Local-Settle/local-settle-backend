/**
 * Centralized, exhaustive list of audit-loggable action names.
 *
 * Every critical write path across the platform (auth, payment methods,
 * offers/orders, escrow, disputes, KYC, admin actions) must record its
 * activity using one of these action names, so indexers, security review,
 * and compliance queries can rely on a stable, closed set of values rather
 * than free-form strings.
 */
export enum AuditAction {
  USER_LOGIN_SUCCESS = 'USER_LOGIN_SUCCESS',
  USER_LOGIN_FAILURE = 'USER_LOGIN_FAILURE',
  AUTH_CHALLENGE_CREATED = 'AUTH_CHALLENGE_CREATED',

  USER_DATA_EXPORTED = 'USER_DATA_EXPORTED',
  USER_DATA_DELETED = 'USER_DATA_DELETED',
  USER_PROFILE_UPDATED = 'USER_PROFILE_UPDATED',

  PAYMENT_METHOD_CREATED = 'PAYMENT_METHOD_CREATED',
  PAYMENT_METHOD_UPDATED = 'PAYMENT_METHOD_UPDATED',
  PAYMENT_METHOD_DELETED = 'PAYMENT_METHOD_DELETED',

  OFFER_CREATED = 'OFFER_CREATED',
  OFFER_UPDATED = 'OFFER_UPDATED',
  OFFER_CANCELLED = 'OFFER_CANCELLED',

  ORDER_CREATED = 'ORDER_CREATED',
  ORDER_CANCELLED = 'ORDER_CANCELLED',
  ORDER_EXPIRED = 'ORDER_EXPIRED',

  ESCROW_CREATED = 'ESCROW_CREATED',
  ESCROW_FUNDED = 'ESCROW_FUNDED',
  ESCROW_RELEASED = 'ESCROW_RELEASED',
  ESCROW_REFUNDED = 'ESCROW_REFUNDED',
  ESCROW_CANCELLED = 'ESCROW_CANCELLED',
  ESCROW_DISPUTED = 'ESCROW_DISPUTED',

  DISPUTE_OPENED = 'DISPUTE_OPENED',
  DISPUTE_RESOLVED = 'DISPUTE_RESOLVED',

  KYC_STATUS_UPDATED = 'KYC_STATUS_UPDATED',

  ADMIN_ACTION_EXECUTED = 'ADMIN_ACTION_EXECUTED',
}

/**
 * The outcome of an audited operation. Kept as a small closed set (rather
 * than a free-form string) so `result` stays queryable and consistent
 * across every call site.
 */
export enum AuditResult {
  SUCCESS = 'SUCCESS',
  FAILURE = 'FAILURE',
}
