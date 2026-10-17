import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

interface RequestWithUser {
  user?: { setupComplete?: boolean };
}

/** Blocks profile-dependent routes for wallet sessions still in onboarding. */
@Injectable()
export class SetupCompleteGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    if (request.user?.setupComplete !== true) {
      throw new ForbiddenException('Complete account setup to access this route');
    }
    return true;
  }
}
