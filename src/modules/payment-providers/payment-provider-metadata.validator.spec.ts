import { validatePaymentProviderMetadata } from './payment-provider-metadata.validator';

describe('validatePaymentProviderMetadata', () => {
  it.each([
    [
      'BANK',
      {
        ui_requirements: [
          { db_field: 'account_identifier', label: 'Account number', type: 'text', required: true },
          { db_field: 'beneficiary_name', label: 'Account holder', type: 'text', required: false },
        ],
      },
    ],
    [
      'MOBILE',
      {
        ui_requirements: [
          { db_field: 'account_identifier', label: 'Phone number', type: 'tel', required: true },
          { db_field: 'identification_number', label: 'ID number', type: 'text', required: true },
        ],
      },
    ],
    [
      'PLATFORM',
      {
        ui_requirements: [
          { db_field: 'account_identifier', label: 'PayPal email', type: 'email', required: true },
        ],
      },
    ],
  ])('accepts versioned local %s provider metadata', (type, metadata) => {
    expect(validatePaymentProviderMetadata(type as string, metadata)).toBe(1);
  });

  it('rejects unknown provider types and malformed UI fields', () => {
    expect(() => validatePaymentProviderMetadata('UNKNOWN', {})).toThrow();
    expect(() =>
      validatePaymentProviderMetadata('BANK', {
        ui_requirements: [
          { db_field: 'routing_number', label: 'Routing', type: 'text', required: true },
        ],
      }),
    ).toThrow('Payment provider metadata does not match its provider type schema.');
  });
});
