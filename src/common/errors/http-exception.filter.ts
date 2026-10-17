import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ErrorCode } from './error-codes.enum';
import { PAYLOAD_TOO_LARGE_RESPONSE } from '../request-limits';

/**
 * Global exception filter that normalises ALL HTTP exceptions — both
 * AppException (already structured) and NestJS built-ins (BadRequestException,
 * NotFoundException, etc.) — into the shared error response shape:
 *
 *   { statusCode, error, message }
 *
 * Unhandled non-HTTP errors are caught and returned as 500 INTERNAL_SERVER_ERROR.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (this.isPayloadTooLarge(exception)) {
      return response.status(HttpStatus.PAYLOAD_TOO_LARGE).json({
        ...PAYLOAD_TOO_LARGE_RESPONSE,
        error: ErrorCode.PAYLOAD_TOO_LARGE,
      });
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();

      // AppException already returns { statusCode, error, message }
      if (
        typeof raw === 'object' &&
        raw !== null &&
        'error' in raw &&
        'message' in raw &&
        'statusCode' in raw
      ) {
        return response.status(status).json(raw);
      }

      // NestJS built-in exceptions: shape varies, normalise them
      const message = this.extractMessage(raw);
      const error = this.httpStatusToErrorCode(status);

      return response.status(status).json({
        statusCode: status,
        error,
        message,
      });
    }

    // Unexpected / non-HTTP errors
    this.logger.error(
      `Unhandled exception on ${request.method} ${request.url}`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: ErrorCode.INTERNAL_SERVER_ERROR,
      message: 'An unexpected error occurred',
    });
  }

  private isPayloadTooLarge(exception: unknown): boolean {
    if (!exception || typeof exception !== 'object') return false;
    const error = exception as {
      status?: number;
      statusCode?: number;
      code?: string;
      type?: string;
    };
    return (
      error.status === HttpStatus.PAYLOAD_TOO_LARGE ||
      error.statusCode === HttpStatus.PAYLOAD_TOO_LARGE ||
      error.type === 'entity.too.large' ||
      error.code === 'LIMIT_FILE_SIZE' ||
      error.code === 'LIMIT_FIELD_VALUE' ||
      error.code === 'LIMIT_FIELD_COUNT' ||
      error.code === 'LIMIT_PART_COUNT' ||
      error.code === 'LIMIT_FILE_COUNT'
    );
  }

  private extractMessage(raw: unknown): string {
    if (typeof raw === 'string') return raw;

    if (typeof raw === 'object' && raw !== null) {
      const obj = raw as Record<string, unknown>;

      // class-validator returns { message: string[] } inside BadRequestException
      if (Array.isArray(obj['message'])) {
        return (obj['message'] as string[]).join('; ');
      }
      if (typeof obj['message'] === 'string') return obj['message'];
      if (typeof obj['error'] === 'string') return obj['error'];
    }

    return 'An error occurred';
  }

  private httpStatusToErrorCode(status: number): ErrorCode {
    const map: Partial<Record<number, ErrorCode>> = {
      400: ErrorCode.VALIDATION_ERROR,
      401: ErrorCode.UNAUTHORIZED_ACTION,
      403: ErrorCode.UNAUTHORIZED_ACTION,
      404: ErrorCode.RESOURCE_NOT_FOUND, // generic fallback; AppException provides precision
      413: ErrorCode.PAYLOAD_TOO_LARGE,
      422: ErrorCode.VALIDATION_ERROR,
      500: ErrorCode.INTERNAL_SERVER_ERROR,
      502: ErrorCode.INTERNAL_SERVER_ERROR,
      503: ErrorCode.INTERNAL_SERVER_ERROR,
    };
    return map[status] ?? ErrorCode.INTERNAL_SERVER_ERROR;
  }
}
