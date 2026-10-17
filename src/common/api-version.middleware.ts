import type { NextFunction, Request, Response } from 'express';

/** Marks the response contract version without changing existing route URLs. */
export function apiVersionMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const match = req.path.match(/^\/v(\d+)(?:\/|$)/);
  res.setHeader('X-API-Version', match?.[1] ?? '1');
  next();
}
