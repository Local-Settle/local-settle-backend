import { Test, TestingModule } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PrismaService } from '../../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

describe('HealthController', () => {
  let controller: HealthController;

  const prismaMock = {
    $queryRaw: jest.fn(),
  };
  const configMock = { get: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
        { provide: ConfigService, useValue: configMock },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    jest.clearAllMocks();
    configMock.get.mockReturnValue(undefined);
  });

  it('should return 200 with status ok and db up when DB is reachable', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);

    const res = await controller.getHealth();

    expect(res.status).toBe('ok');
    expect(res.db).toBe('up');
    expect(typeof res.uptime).toBe('number');
    expect(new Date(res.timestamp).getTime()).not.toBeNaN();
    expect(prismaMock.$queryRaw).toHaveBeenCalled();
    expect(res.stellar).toEqual({
      network: 'testnet',
      horizonHost: 'horizon-testnet.stellar.org',
      sorobanHost: 'soroban-testnet.stellar.org',
    });
  });

  it('reports configured network and endpoint hosts without URL credentials or paths', async () => {
    configMock.get.mockImplementation((key: string) => ({
      STELLAR_NETWORK: 'public',
      STELLAR_HORIZON_URL: 'https://user:secret@example.org/private/path',
      STELLAR_RPC_URL: 'https://rpc.example.org/rpc?token=secret',
    })[key]);
    prismaMock.$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);

    const res = await controller.getHealth();

    expect(res.stellar).toEqual({
      network: 'public',
      horizonHost: 'example.org',
      sorobanHost: 'rpc.example.org',
    });
    expect(JSON.stringify(res)).not.toContain('secret');
  });

  it('should throw ServiceUnavailableException with degraded status and db down when DB fails', async () => {
    prismaMock.$queryRaw.mockRejectedValueOnce(
      new Error('DB Connection Refused'),
    );

    await expect(controller.getHealth()).rejects.toThrow(
      ServiceUnavailableException,
    );

    try {
      await controller.getHealth();
    } catch (err) {
      if (err instanceof ServiceUnavailableException) {
        const response = err.getResponse() as Record<string, unknown>;
        expect(response.status).toBe('degraded');
        expect(response.db).toBe('down');
      }
    }
  });
});
