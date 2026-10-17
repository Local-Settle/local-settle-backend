import { AppException, ErrorCode } from '../../common/errors';

interface ProviderMetadataSchema {
  version: number;
  fields: readonly string[];
}

export const PROVIDER_METADATA_SCHEMAS: Record<string, ProviderMetadataSchema> = {
  BANK: {
    version: 1,
    fields: ['account_identifier', 'beneficiary_name', 'identification_number'],
  },
  MOBILE: {
    version: 1,
    fields: ['account_identifier', 'beneficiary_name', 'identification_number'],
  },
  PLATFORM: {
    version: 1,
    fields: ['account_identifier', 'beneficiary_name'],
  },
};

const INPUT_TYPES = new Set(['email', 'tel', 'text']);

export function validatePaymentProviderMetadata(
  providerType: string,
  metadata: unknown,
): number {
  const schema = PROVIDER_METADATA_SCHEMAS[providerType];
  if (!schema || !metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw invalidMetadata();
  }

  const requirements = (metadata as { ui_requirements?: unknown }).ui_requirements;
  if (!Array.isArray(requirements) || requirements.length === 0) {
    throw invalidMetadata();
  }

  const fields = new Set<string>();
  for (const item of requirements) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw invalidMetadata();
    }
    const requirement = item as Record<string, unknown>;
    const field = requirement.db_field;
    if (
      typeof field !== 'string' ||
      !schema.fields.includes(field) ||
      fields.has(field) ||
      typeof requirement.label !== 'string' ||
      !requirement.label.trim() ||
      typeof requirement.type !== 'string' ||
      !INPUT_TYPES.has(requirement.type) ||
      typeof requirement.required !== 'boolean' ||
      (requirement.placeholder !== undefined &&
        typeof requirement.placeholder !== 'string')
    ) {
      throw invalidMetadata();
    }
    fields.add(field);
  }

  if (!requirements.some((item) => (item as Record<string, unknown>).db_field === 'account_identifier' && (item as Record<string, unknown>).required === true)) {
    throw invalidMetadata();
  }
  return schema.version;
}

function invalidMetadata(): AppException {
  return new AppException(
    ErrorCode.VALIDATION_ERROR,
    'Payment provider metadata does not match its provider type schema.',
  );
}
