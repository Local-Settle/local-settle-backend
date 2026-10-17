import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { SetupCompleteGuard } from './setup-complete.guard';

describe('SetupCompleteGuard', () => {
  const guard = new SetupCompleteGuard();

  const contextFor = (user?: { setupComplete?: boolean }) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  it('allows a finalized session', () => {
    expect(guard.canActivate(contextFor({ setupComplete: true }))).toBe(true);
  });

  it.each([undefined, {}, { setupComplete: false }])(
    'rejects a temporary session (%j)',
    (user) => {
      expect(() => guard.canActivate(contextFor(user))).toThrow(
        ForbiddenException,
      );
    },
  );
});
