import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { validateEscrowStellarConfig } from './stellar-config.validation';

export const CRITICAL_ENV_VARS = [
  'DATABASE_URL',
  'JWT_SECRET',
  'STELLAR_HORIZON_URL',
  'STELLAR_NETWORK',
  'STELLAR_SIGNER_SECRET',
  'TRUSTLESS_WORK_API_URL',
  'TRUSTLESS_WORK_API_KEY',
  'TRUSTLESS_WORK_USDC_ISSUER',
  'DIDIT_API_KEY',
  'DIDIT_WEBHOOK_SECRET',
  'DIDIT_API_URL',
  'DIDIT_WORKFLOW_ID',
  'KYC_CALLBACK_URL',
] as const;

@Injectable()
export class EnvValidationService implements OnModuleInit {
  private readonly logger = new Logger(EnvValidationService.name);

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    if (
      process.env.NODE_ENV === 'test' &&
      !process.env.ENFORCE_ENV_VALIDATION
    ) {
      return;
    }
    this.validateCriticalEnvs();
    this.validateEscrowConfiguration();
  }

  validateCriticalEnvs(requiredKeys: readonly string[] = CRITICAL_ENV_VARS) {
    const missingKeys: string[] = [];

    for (const key of requiredKeys) {
      const val = this.configService.get<string>(key);
      if (val === undefined || val === null || val.trim() === '') {
        missingKeys.push(key);
      }
    }

    if (missingKeys.length > 0) {
      const errorMsg = `Missing or empty critical environment variable(s): ${missingKeys.join(', ')}`;
      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }
  }

  validateEscrowConfiguration(): void {
    validateEscrowStellarConfig({
      network: this.configService.get<string>('STELLAR_NETWORK'),
      treasuryAddress: this.configService.get<string>(
        'IKASH_TREASURY_ADDRESS',
      ),
      supportAddress: this.configService.get<string>('IKASH_SUPPORT_ADDRESS'),
      deployerSecret: this.configService.get<string>('IKASH_DEPLOYER_SECRET'),
    });
  }
}
