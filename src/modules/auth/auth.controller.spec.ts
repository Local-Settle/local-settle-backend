import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import type { Request, Response } from 'express';
import { CSRF_COOKIE_NAME } from '../../config/cookie.config';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';

describe('AuthController', () => {
  let controller: AuthController;

  const createChallengeMock = jest.fn();
  const loginMock = jest.fn();
  const revokeSessionMock = jest.fn();

  const mockAuthService = {
    createChallenge: createChallengeMock,
    login: loginMock,
    revokeSession: revokeSessionMock,
  };

  const mockAuthRateLimitGuard = {
    canActivate: jest.fn(() => true),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
      ],
    })
      .overrideGuard(AuthRateLimitGuard)
      .useValue(mockAuthRateLimitGuard)
      .compile();

    controller = module.get<AuthController>(AuthController);
    jest.clearAllMocks();
  });

  describe('getCsrfToken', () => {
    it('should generate a fresh 64-char hex token when no cookie is present', () => {
      const mockReq = {
        cookies: {},
        headers: {},
      } as unknown as Request;

      const cookieMock = jest.fn();
      const mockRes = {
        cookie: cookieMock,
      } as unknown as Response;

      const result = controller.getCsrfToken(mockReq, mockRes);

      expect(result).toHaveProperty('csrfToken');
      expect(result.csrfToken).toMatch(/^[a-f0-9]{64}$/i);
      expect(cookieMock).toHaveBeenCalledWith(
        CSRF_COOKIE_NAME,
        result.csrfToken,
        expect.objectContaining({ httpOnly: true, path: '/' }),
      );
    });

    it('should reuse an existing valid 64-char hex token from cookies', () => {
      const validToken = 'a'.repeat(64);
      const mockReq = {
        cookies: { [CSRF_COOKIE_NAME]: validToken },
        headers: {},
      } as unknown as Request;

      const cookieMock = jest.fn();
      const mockRes = {
        cookie: cookieMock,
      } as unknown as Response;

      const result = controller.getCsrfToken(mockReq, mockRes);

      expect(result.csrfToken).toBe(validToken);
      expect(cookieMock).toHaveBeenCalledWith(
        CSRF_COOKIE_NAME,
        validToken,
        expect.anything(),
      );
    });

    it('should parse cookies from headers.cookie if req.cookies is undefined', () => {
      const validToken = 'f'.repeat(64);
      const mockReq = {
        cookies: undefined,
        headers: {
          cookie: `other=123; ${CSRF_COOKIE_NAME}=${validToken}; test=456`,
        },
      } as unknown as Request;

      const cookieMock = jest.fn();
      const mockRes = {
        cookie: cookieMock,
      } as unknown as Response;

      const result = controller.getCsrfToken(mockReq, mockRes);

      expect(result.csrfToken).toBe(validToken);
      expect(cookieMock).toHaveBeenCalledWith(
        CSRF_COOKIE_NAME,
        validToken,
        expect.anything(),
      );
    });

    it('should generate a fresh token if existing token is malformed / not 64 hex chars', () => {
      const invalidTokens = [
        'short-token',
        '12345',
        'g'.repeat(64), // invalid hex char 'g'
        'a'.repeat(63), // too short
        'a'.repeat(65), // too long
        '   ',
      ];

      for (const invalidToken of invalidTokens) {
        const mockReq = {
          cookies: { [CSRF_COOKIE_NAME]: invalidToken },
          headers: {},
        } as unknown as Request;

        const cookieMock = jest.fn();
        const mockRes = {
          cookie: cookieMock,
        } as unknown as Response;

        const result = controller.getCsrfToken(mockReq, mockRes);

        expect(result.csrfToken).not.toBe(invalidToken);
        expect(result.csrfToken).toMatch(/^[a-f0-9]{64}$/i);
      }
    });
  });

  describe('createChallenge', () => {
    it('should delegate to authService.createChallenge', async () => {
      const dto = {
        publicKey: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      };
      createChallengeMock.mockResolvedValue({
        challenge: 'challenge-string',
        expiresAt: '2026-08-25T12:00:00.000Z',
      });

      const result = await controller.createChallenge(dto);

      expect(createChallengeMock).toHaveBeenCalledWith(dto);
      expect(result).toEqual({
        challenge: 'challenge-string',
        expiresAt: '2026-08-25T12:00:00.000Z',
      });
    });
  });

  describe('login', () => {
    it('should pass dto and request context to authService.login', async () => {
      const dto = {
        publicKey: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        signature: 'valid-signature',
      };
      const mockReq = {
        ip: '127.0.0.1',
        headers: { 'user-agent': 'Jest-Test-Agent' },
      } as unknown as Request;

      loginMock.mockResolvedValue({
        token: 'jwt-token',
        user: { id: 'user-id', address: dto.publicKey },
      });

      const result = await controller.login(dto, mockReq);

      expect(loginMock).toHaveBeenCalledWith(dto, {
        ipAddress: '127.0.0.1',
        userAgent: 'Jest-Test-Agent',
      });
      expect(result).toEqual({
        token: 'jwt-token',
        user: { id: 'user-id', address: dto.publicKey },
      });
    });
  });

  describe('logout', () => {
    it('revokes only the session on the authenticated request', async () => {
      const request = {
        user: { userId: 'user-1', sessionId: 'session-1' },
      } as unknown as Request & {
        user: { userId: string; sessionId: string };
      };
      revokeSessionMock.mockResolvedValue({ revoked: true });

      await expect(controller.logout(request)).resolves.toEqual({
        revoked: true,
      });
      expect(revokeSessionMock).toHaveBeenCalledWith('user-1', 'session-1');
    });
  });
});
