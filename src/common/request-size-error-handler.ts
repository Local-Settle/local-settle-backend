import type { NextFunction, Request, Response } from 'express';
import { PAYLOAD_TOO_LARGE_RESPONSE } from './request-limits';

export function requestSizeErrorHandler(
  error: { status?: number; statusCode?: number; type?: string } | null,
  _request: Request,
  response: Response,
  next: NextFunction,
) {
  if (
    error?.status === 413 ||
    error?.statusCode === 413 ||
    error?.type === 'entity.too.large'
  ) {
    return response.status(413).json(PAYLOAD_TOO_LARGE_RESPONSE);
  }
  return next(error);
}
