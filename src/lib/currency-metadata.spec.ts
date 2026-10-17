import { getCurrencyMetadata } from './currency-metadata';

describe('getCurrencyMetadata', () => {
  it.each([
    ['USD', 2],
    ['JPY', 0],
    ['KWD', 3],
  ])('returns ISO minor-unit precision for %s', (currency, minorUnit) => {
    expect(getCurrencyMetadata(currency)).toEqual({
      currency,
      locale: 'en-US',
      minorUnit,
    });
  });

  it('normalizes currency codes and locale tags', () => {
    expect(getCurrencyMetadata(' usd ', 'en-us')).toEqual({
      currency: 'USD',
      locale: 'en-US',
      minorUnit: 2,
    });
  });

  it('rejects unsupported currency codes and malformed locales', () => {
    expect(getCurrencyMetadata('ZZZ')).toBeNull();
    expect(getCurrencyMetadata('USD', 'not_a_locale')).toBeNull();
  });
});
