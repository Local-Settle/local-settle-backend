import { ConfigService } from '@nestjs/config';
import { AxiosError, AxiosResponse } from 'axios';
import { TrustlessWorkService } from './trustless-work.service';

describe('TrustlessWorkService resilience', () => {
  function setup() {
    const service = new TrustlessWorkService({ get: jest.fn() } as unknown as ConfigService);
    const http = {
      get: jest.fn(),
      post: jest.fn(),
    };
    Object.defineProperty(service, 'http', { value: http });
    return { service, http };
  }

  function unavailable() {
    const error = new AxiosError('service unavailable');
    error.response = {
      status: 503,
      data: { message: 'upstream unavailable' },
    } as AxiosResponse;
    return error;
  }

  it('retries a transient GET failure and returns the later success', async () => {
    const { service, http } = setup();
    http.get
      .mockRejectedValueOnce(unavailable())
      .mockResolvedValueOnce({ data: [{ contractId: 'contract-1' }] });

    await expect(service.getEscrowByContractId('contract-1')).resolves.toEqual([
      { contractId: 'contract-1' },
    ]);
    expect(http.get).toHaveBeenCalledTimes(2);
  });

  it('opens the read circuit after repeated failures and never retries POST', async () => {
    const { service, http } = setup();
    http.get.mockRejectedValue(unavailable());

    await expect(service.getEscrowByContractId('contract-1')).rejects.toThrow(
      'Escrow operation failed: upstream unavailable',
    );
    expect(http.get).toHaveBeenCalledTimes(3);
    await expect(service.getEscrowByContractId('contract-1')).rejects.toThrow(
      'temporarily unavailable',
    );
    expect(http.get).toHaveBeenCalledTimes(3);

    http.post.mockRejectedValue(unavailable());
    await expect(service.sendTransaction('signed-xdr')).rejects.toThrow(
      'Escrow operation failed: upstream unavailable',
    );
    expect(http.post).toHaveBeenCalledTimes(1);
  });
});
