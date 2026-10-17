import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from './error-codes.enum';

export interface AppErrorResponse {
  statusCode: number;
  error: ErrorCode;
  message: string;
}

/**
 * Maps a stable ErrorCode to its canonical HTTP status.
 *
 * This is the "reverse" of the status→code mapping in HttpExceptionFilter.
 * It lets callers throw `new AppException(ErrorCode.ORDER_NOT_FOUND, msg)`
 * without repeating `HttpStatus.NOT_FOUND` every time — the status is inferred
 * from the code. If a code is not in the map, the constructor defaults to 400.
 */
export function errorCodeToHttpStatus(code: ErrorCode): HttpStatus {
  const map: Partial<Record<ErrorCode, HttpStatus>> = {
    // ── 400 Bad Request ──────────────────────────────────────────────
    [ErrorCode.INVALID_WALLET]: HttpStatus.BAD_REQUEST,
    [ErrorCode.INVALID_EMAIL]: HttpStatus.BAD_REQUEST,
    [ErrorCode.MISSING_EMAIL]: HttpStatus.BAD_REQUEST,
    [ErrorCode.MISSING_USER_ID]: HttpStatus.BAD_REQUEST,
    [ErrorCode.USER_ALREADY_EXISTS]: HttpStatus.BAD_REQUEST,
    [ErrorCode.ESCROW_ALREADY_EXISTS]: HttpStatus.BAD_REQUEST,
    [ErrorCode.ESCROW_NOT_INITIALIZED]: HttpStatus.BAD_REQUEST,
    [ErrorCode.ESCROW_NO_CONTRACT]: HttpStatus.BAD_REQUEST,
    [ErrorCode.ESCROW_CREATION_FAILED]: HttpStatus.BAD_REQUEST,
    [ErrorCode.ESCROW_INVALID_STATUS]: HttpStatus.BAD_REQUEST,
    [ErrorCode.UNSUPPORTED_ASSET]: HttpStatus.BAD_REQUEST,
    [ErrorCode.INVALID_STELLAR_ADDRESS]: HttpStatus.BAD_REQUEST,
    [ErrorCode.INVALID_AMOUNT]: HttpStatus.BAD_REQUEST,
    [ErrorCode.MISSING_SIGNER_SECRET]: HttpStatus.BAD_REQUEST,
    [ErrorCode.MISSING_ASSET_ISSUER]: HttpStatus.BAD_REQUEST,
    [ErrorCode.VALIDATION_ERROR]: HttpStatus.BAD_REQUEST,
    [ErrorCode.MISSING_PAYMENT_PROVIDER]: HttpStatus.BAD_REQUEST,
    [ErrorCode.INVALID_ACCOUNT_IDENTIFIER]: HttpStatus.BAD_REQUEST,
    [ErrorCode.SELF_SEND]: HttpStatus.BAD_REQUEST,
    [ErrorCode.AMOUNT_TOO_SMALL]: HttpStatus.BAD_REQUEST,
    [ErrorCode.MISSING_FEE_COLLECTOR]: HttpStatus.BAD_REQUEST,

    // ── 409 Conflict ──────────────────────────────────────────────────
    [ErrorCode.ALIAS_TAKEN]: HttpStatus.CONFLICT,
    [ErrorCode.OFFER_VERSION_CONFLICT]: HttpStatus.CONFLICT,
    [ErrorCode.ORDER_CANCELLATION_NOT_ALLOWED]: HttpStatus.CONFLICT,

    // ── 401 Unauthorized ─────────────────────────────────────────────
    [ErrorCode.KYC_WEBHOOK_INVALID_SIGNATURE]: HttpStatus.UNAUTHORIZED,
    [ErrorCode.INVALID_CHALLENGE]: HttpStatus.UNAUTHORIZED,
    [ErrorCode.INVALID_SIGNATURE]: HttpStatus.UNAUTHORIZED,

    // ── 429 Too Many Requests ─────────────────────────────────────────
    [ErrorCode.TOO_MANY_REQUESTS]: HttpStatus.TOO_MANY_REQUESTS,

    // ── 403 Forbidden ─────────────────────────────────────────────────
    [ErrorCode.UNAUTHORIZED_ACTION]: HttpStatus.FORBIDDEN,
    [ErrorCode.KYC_REQUIRED]: HttpStatus.FORBIDDEN,
    [ErrorCode.CSRF_TOKEN_MISSING]: HttpStatus.FORBIDDEN,
    [ErrorCode.CSRF_TOKEN_INVALID]: HttpStatus.FORBIDDEN,

    // ── 404 Not Found ─────────────────────────────────────────────────
    [ErrorCode.USER_NOT_FOUND]: HttpStatus.NOT_FOUND,
    [ErrorCode.OFFER_NOT_FOUND]: HttpStatus.NOT_FOUND,
    [ErrorCode.ORDER_NOT_FOUND]: HttpStatus.NOT_FOUND,
    [ErrorCode.ESCROW_NOT_FOUND]: HttpStatus.NOT_FOUND,
    [ErrorCode.PAYMENT_METHOD_NOT_FOUND]: HttpStatus.NOT_FOUND,
    [ErrorCode.PAYMENT_PROVIDER_NOT_FOUND]: HttpStatus.NOT_FOUND,
    [ErrorCode.CHAT_MESSAGE_NOT_FOUND]: HttpStatus.NOT_FOUND,
    [ErrorCode.STELLAR_ACCOUNT_NOT_FOUND]: HttpStatus.NOT_FOUND,
    [ErrorCode.RESOURCE_NOT_FOUND]: HttpStatus.NOT_FOUND,
    [ErrorCode.INVALID_RECIPIENT]: HttpStatus.NOT_FOUND,

    // ── 500 Internal Server Error ─────────────────────────────────────
    [ErrorCode.KYC_SESSION_FAILED]: HttpStatus.INTERNAL_SERVER_ERROR,
    [ErrorCode.KYC_WEBHOOK_MISSING_BODY]: HttpStatus.INTERNAL_SERVER_ERROR,
    [ErrorCode.KYC_WEBHOOK_SECRET_MISSING]: HttpStatus.INTERNAL_SERVER_ERROR,
    [ErrorCode.ESCROW_SYNC_FAILED]: HttpStatus.INTERNAL_SERVER_ERROR,
    [ErrorCode.ESCROW_APPROVE_FAILED]: HttpStatus.INTERNAL_SERVER_ERROR,
    [ErrorCode.STELLAR_TRANSACTION_FAILED]: HttpStatus.INTERNAL_SERVER_ERROR,
    [ErrorCode.INTERNAL_SERVER_ERROR]: HttpStatus.INTERNAL_SERVER_ERROR,
  };

  // Default to 400 if the code is not in the map
  return map[code] ?? HttpStatus.BAD_REQUEST;
}

/**
 * Structured application exception.
 *
 * Every error thrown with AppException will produce a response shaped as:
 * {
 *   statusCode: number,
 *   error: ErrorCode,   // stable uppercase token — safe for frontend branching
 *   message: string     // human-readable detail
 * }
 *
 * The HTTP status is automatically inferred from the ErrorCode via
 * errorCodeToHttpStatus(). You can still override it explicitly by passing
 * a third argument when needed.
 *
 * @example — status inferred from code (preferred):
 *   throw new AppException(ErrorCode.ORDER_NOT_FOUND, 'Order abc123 not found');
 *   // → 404
 *
 * @example — explicit status override (when needed):
 *   throw new AppException(ErrorCode.ESCROW_CREATION_FAILED, msg, HttpStatus.BAD_GATEWAY);
 */
export class AppException extends HttpException {
  constructor(
    errorCode: ErrorCode,
    message: string,
    statusCode: HttpStatus = errorCodeToHttpStatus(errorCode),
  ) {
    const response: AppErrorResponse = {
      statusCode,
      error: errorCode,
      message,
    };
    super(response, statusCode);
  }
}
