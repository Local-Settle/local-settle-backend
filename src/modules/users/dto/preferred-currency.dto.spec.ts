import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateUserDto } from './update-users.dto';
import { SetupAccountDto } from './setup-account.dto';

describe('preferred currency DTO validation', () => {
  it.each([UpdateUserDto, SetupAccountDto])(
    'normalizes supported ISO currency codes in %p',
    async (Dto) => {
      const dto = plainToInstance(Dto, { preferredCurrency: ' usd ' });
      expect(dto.preferredCurrency).toBe('USD');
      await expect(validate(dto)).resolves.toHaveLength(0);
    },
  );

  it.each([UpdateUserDto, SetupAccountDto])(
    'rejects unsupported currency codes in %p',
    async (Dto) => {
      const dto = plainToInstance(Dto, { preferredCurrency: 'ZZZ' });
      expect(await validate(dto)).not.toHaveLength(0);
    },
  );
});
