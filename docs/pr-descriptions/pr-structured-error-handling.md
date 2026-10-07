# feat: Structured Error Handling — Stable Error Codes for All Endpoints

## Summary

This PR implements a standardized, structured error response format across all LocalSettle backend
controllers and services. Every error response now returns a consistent object that the frontend
can safely depend on, regardless of human-readable message changes.

### Error Response Shape

```json
{
  "statusCode": 400,
  "error": "INVALID_WALLET",
  "message": "Invalid public key. Must start with \"G\" and be at least 50 characters."
}
```

- `statusCode` — the HTTP status code
- `error` — a **stable uppercase token** the frontend can switch/branch on (never changes)
- `message` — human-readable description (may evolve over time)

---

## What Changed

### New Files — `src/common/errors/`

| File                       | Purpose                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `error-codes.enum.ts`      | Centralized `ErrorCode` enum with all stable uppercase error tokens                                                                        |
| `app.exception.ts`         | `AppException` — custom `HttpException` subclass that always produces `{ statusCode, error, message }`                                     |
| `http-exception.filter.ts` | Global `HttpExceptionFilter` that normalizes NestJS built-in exceptions (BadRequestException, NotFoundException, etc.) into the same shape |
| `index.ts`                 | Barrel export for clean imports                                                                                                            |

### `src/main.ts`

Registered `HttpExceptionFilter` as a global exception filter with `app.useGlobalFilters()`.
This ensures **every** uncaught exception — including NestJS framework exceptions, class-validator
validation errors, and JWT guard failures — is normalized into the structured shape.

### Modified Services and Controllers

All `throw new BadRequestException(...)`, `throw new NotFoundException(...)`, and
`throw new InternalServerErrorException(...)` calls have been replaced with
`throw new AppException(ErrorCode.XXX, message, HttpStatus.YYY)`:

| Module          | File(s) Updated                       |
| --------------- | ------------------------------------- |
| Auth            | `auth.controller.ts`                  |
| Users           | `users.service.ts`                    |
| Offer           | `offer.service.ts`                    |
| Order           | `order.service.ts`                    |
| Escrow          | `escrow.service.ts`                   |
| Payment Methods | `payment-methods.service.ts`          |
| Chat Message    | `chat-message.service.ts`             |
| Stellar         | `stellar.service.ts`                  |
| KYC             | `kyc.service.ts`, `kyc.controller.ts` |
| Common Guard    | `kyc-verified.guard.ts`               |

---

## Error Codes Introduced

```ts
// Auth / Wallet
(INVALID_WALLET, MISSING_PUBLIC_KEY, UNAUTHORIZED_ACTION, KYC_REQUIRED);

// User
(USER_NOT_FOUND, USER_ALREADY_EXISTS, INVALID_EMAIL, MISSING_EMAIL);

// Offer / Order
(OFFER_NOT_FOUND, ORDER_NOT_FOUND, INVALID_ORDER_STATUS);

// Escrow
(ESCROW_NOT_FOUND,
  ESCROW_ALREADY_EXISTS,
  ESCROW_NOT_INITIALIZED,
  ESCROW_NO_CONTRACT,
  ESCROW_CREATION_FAILED,
  ESCROW_INVALID_STATUS,
  ESCROW_SYNC_FAILED,
  ESCROW_APPROVE_FAILED,
  UNSUPPORTED_ASSET);

// Payment
(PAYMENT_METHOD_NOT_FOUND, PAYMENT_PROVIDER_NOT_FOUND);

// Chat
CHAT_MESSAGE_NOT_FOUND;

// Stellar
(INVALID_STELLAR_ADDRESS,
  INVALID_AMOUNT,
  STELLAR_ACCOUNT_NOT_FOUND,
  STELLAR_TRANSACTION_FAILED,
  MISSING_SIGNER_SECRET,
  MISSING_ASSET_ISSUER);

// KYC
(KYC_SESSION_FAILED,
  KYC_WEBHOOK_INVALID_SIGNATURE,
  KYC_WEBHOOK_MISSING_BODY,
  KYC_WEBHOOK_SECRET_MISSING,
  MISSING_USER_ID);

// General
(VALIDATION_ERROR, INTERNAL_SERVER_ERROR);
```

---

## How to Use AppException

```ts
import { AppException, ErrorCode } from '../../common/errors';
import { HttpStatus } from '@nestjs/common';

// In any service or controller:
throw new AppException(
  ErrorCode.ORDER_NOT_FOUND,
  `Order ${id} not found`,
  HttpStatus.NOT_FOUND,
);
```

`HttpStatus.BAD_REQUEST` (400) is the default if no third argument is provided.

---

## Frontend Usage

The frontend can now reliably switch on the `error` field:

```ts
if (err.error === 'ORDER_NOT_FOUND') {
  /* show order missing state */
}
if (err.error === 'KYC_REQUIRED') {
  /* redirect to KYC flow */
}
if (err.error === 'UNAUTHORIZED_ACTION') {
  /* redirect to login */
}
```

This is stable — it won't break when message text is updated.

---

## Backward Compatibility

- Successful responses are **not affected** — only error paths changed.
- The `message` field preserves all existing human-readable text.
- NestJS built-in exceptions (e.g. from `ValidationPipe` or `JwtAuthGuard`) are also normalized
  through the global filter, so no endpoint returns an unstructured error anymore.

---

## Testing

- Verify `/auth/login` with no body returns `{ statusCode: 400, error: "MISSING_PUBLIC_KEY", message: "Public key is required" }`.
- Verify `GET /orders/:nonExistentId` returns `{ statusCode: 404, error: "ORDER_NOT_FOUND", ... }`.
- Verify `POST /kyc/webhook` with missing signature returns `{ statusCode: 401, error: "KYC_WEBHOOK_INVALID_SIGNATURE", ... }`.
- Verify a successful `GET /offers` still returns the array without wrapping.

---

closes #18
