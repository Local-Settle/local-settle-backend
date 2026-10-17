import { Keypair, StrKey } from '@stellar/stellar-sdk';

export interface EscrowStellarConfig {
  network: string | undefined;
  treasuryAddress: string | undefined;
  supportAddress: string | undefined;
  deployerSecret: string | undefined;
}

/** Validate escrow signing configuration without including secret values in errors. */
export function validateEscrowStellarConfig(config: EscrowStellarConfig): void {
  const missing = Object.entries({
    IKASH_TREASURY_ADDRESS: config.treasuryAddress,
    IKASH_SUPPORT_ADDRESS: config.supportAddress,
    IKASH_DEPLOYER_SECRET: config.deployerSecret,
  })
    .filter(([, value]) => !value?.trim())
    .map(([name]) => name);

  if (missing.length) {
    throw new Error(`Missing or empty escrow configuration: ${missing.join(', ')}`);
  }

  const network = config.network?.toLowerCase();
  if (network !== 'testnet' && network !== 'public') {
    throw new Error('STELLAR_NETWORK must be either "testnet" or "public".');
  }
  if (!StrKey.isValidEd25519PublicKey(config.treasuryAddress!)) {
    throw new Error('IKASH_TREASURY_ADDRESS must be a valid Stellar account key.');
  }
  if (!StrKey.isValidEd25519PublicKey(config.supportAddress!)) {
    throw new Error('IKASH_SUPPORT_ADDRESS must be a valid Stellar account key.');
  }
  if (!StrKey.isValidEd25519SecretSeed(config.deployerSecret!)) {
    throw new Error('IKASH_DEPLOYER_SECRET must be a valid Stellar secret seed.');
  }

  let deployerAddress: string;
  try {
    deployerAddress = Keypair.fromSecret(config.deployerSecret!).publicKey();
  } catch {
    throw new Error('IKASH_DEPLOYER_SECRET could not be validated.');
  }
  if (deployerAddress !== config.treasuryAddress) {
    throw new Error('IKASH_DEPLOYER_SECRET does not match IKASH_TREASURY_ADDRESS.');
  }
}
