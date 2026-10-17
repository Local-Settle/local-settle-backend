import { Keypair } from '@stellar/stellar-sdk';
import { validateEscrowStellarConfig } from './stellar-config.validation';

describe('validateEscrowStellarConfig', () => {
  it('accepts valid generated account keys and a matching deployer secret', () => {
    const treasury = Keypair.random();
    const support = Keypair.random();

    expect(() =>
      validateEscrowStellarConfig({
        network: 'testnet',
        treasuryAddress: treasury.publicKey(),
        supportAddress: support.publicKey(),
        deployerSecret: treasury.secret(),
      }),
    ).not.toThrow();
  });

  it('rejects missing, malformed, and mismatched configuration without exposing secrets', () => {
    const treasury = Keypair.random();
    const other = Keypair.random();

    expect(() =>
      validateEscrowStellarConfig({
        network: 'testnet',
        treasuryAddress: undefined,
        supportAddress: treasury.publicKey(),
        deployerSecret: treasury.secret(),
      }),
    ).toThrow(/IKASH_TREASURY_ADDRESS/);
    expect(() =>
      validateEscrowStellarConfig({
        network: 'testnet',
        treasuryAddress: 'malformed',
        supportAddress: treasury.publicKey(),
        deployerSecret: treasury.secret(),
      }),
    ).toThrow(/valid Stellar account key/);
    expect(() =>
      validateEscrowStellarConfig({
        network: 'public',
        treasuryAddress: treasury.publicKey(),
        supportAddress: treasury.publicKey(),
        deployerSecret: other.secret(),
      }),
    ).toThrow(/does not match/);
  });
});
