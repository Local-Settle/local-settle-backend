import { Request } from 'express';

export type AuthenticatedRequest = Request & {
  user?: {
    userId?: string;
    id?: string;
    publicKey?: string;
  };
};
