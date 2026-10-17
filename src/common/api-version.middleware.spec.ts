import { apiVersionMiddleware } from './api-version.middleware';

describe('apiVersionMiddleware', () => {
  it.each(['/health', '/auth/challenge', '/orders'])('marks the existing %s route as version 1', (path) => {
    const res = { setHeader: jest.fn() };
    const next = jest.fn();
    apiVersionMiddleware({ path } as never, res as never, next);
    expect(res.setHeader).toHaveBeenCalledWith('X-API-Version', '1');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('marks a future URI version with its explicit version number', () => {
    const res = { setHeader: jest.fn() };
    apiVersionMiddleware({ path: '/v2/auth/challenge' } as never, res as never, jest.fn());
    expect(res.setHeader).toHaveBeenCalledWith('X-API-Version', '2');
  });
});
