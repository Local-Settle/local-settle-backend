export const SUPPORTED_CURRENCY_CODES = Intl.supportedValuesOf('currency');

export interface CurrencyMetadata {
  currency: string;
  locale: string;
  minorUnit: number;
}

/** Returns deterministic ISO currency precision and a canonical locale. */
export function getCurrencyMetadata(
  currency: string,
  locale = 'en-US',
): CurrencyMetadata | null {
  const code = currency.trim().toUpperCase();
  if (!SUPPORTED_CURRENCY_CODES.includes(code)) return null;

  let canonicalLocale: string;
  try {
    canonicalLocale = Intl.getCanonicalLocales(locale)[0];
  } catch {
    return null;
  }
  if (!canonicalLocale) return null;

  const { maximumFractionDigits } = new Intl.NumberFormat(canonicalLocale, {
    style: 'currency',
    currency: code,
  }).resolvedOptions();

  return {
    currency: code,
    locale: canonicalLocale,
    minorUnit: maximumFractionDigits,
  };
}
