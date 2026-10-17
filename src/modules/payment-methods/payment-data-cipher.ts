import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const FIELD_NAMES = ['accountIdentifier', 'identificationNumber', 'beneficiaryName'] as const;
type SensitiveFields = Partial<Record<(typeof FIELD_NAMES)[number], string | null>>;

/** AES-256-GCM envelope using versioned keys supplied by the deployment secret manager. */
export class PaymentDataCipher {
  encryptFields<T extends SensitiveFields>(value: T): T {
    const result = { ...value };
    for (const field of FIELD_NAMES) {
      const plaintext = result[field];
      if (typeof plaintext !== 'string' || plaintext.startsWith('enc:')) continue;
      const version = process.env.PAYMENT_DATA_ENCRYPTION_CURRENT_VERSION ?? 'v1';
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', this.keyFor(version), iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      result[field] = `enc:${version}:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ciphertext.toString('base64')}`;
    }
    return result;
  }

  decryptFields<T extends SensitiveFields>(value: T): T {
    const result = { ...value };
    for (const field of FIELD_NAMES) {
      const envelope = result[field];
      if (typeof envelope !== 'string' || !envelope.startsWith('enc:')) continue;
      const [prefix, version, ivText, tagText, ciphertextText] = envelope.split(':');
      if (prefix !== 'enc' || !version || !ivText || !tagText || !ciphertextText) {
        throw new Error('Invalid encrypted payment-data envelope');
      }
      const decipher = createDecipheriv('aes-256-gcm', this.keyFor(version), Buffer.from(ivText, 'base64'));
      decipher.setAuthTag(Buffer.from(tagText, 'base64'));
      result[field] = Buffer.concat([
        decipher.update(Buffer.from(ciphertextText, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    }
    return result;
  }

  private keyFor(version: string): Buffer {
    let keys: Record<string, string> = {};
    try {
      keys = JSON.parse(process.env.PAYMENT_DATA_ENCRYPTION_KEYS ?? '{}') as Record<string, string>;
    } catch {
      throw new Error('Payment-data encryption key configuration is invalid');
    }
    const configured = keys[version] ?? (version === 'v1' ? process.env.PAYMENT_DATA_ENCRYPTION_KEY : undefined);
    if (!configured) throw new Error(`Payment-data encryption key ${version} is unavailable`);
    const key = Buffer.from(configured, 'base64');
    if (key.length !== 32) throw new Error(`Payment-data encryption key ${version} must decode to 32 bytes`);
    return key;
  }
}
