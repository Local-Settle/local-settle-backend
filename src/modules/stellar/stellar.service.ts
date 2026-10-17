import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Asset,
  BASE_FEE,
  FeeBumpTransaction,
  Horizon,
  Keypair,
  Memo,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { AppException, ErrorCode } from '../../common/errors';
import { describeHorizonError } from '../../lib/utils/stellar-error.util';

type NetworkType = 'testnet' | 'public';

export interface BalanceRecord {
  asset_type: string;
  asset_code: string | null;
  asset_issuer: string | null;
  balance: string;
  limit: string | null;
  minimum_reserve?: string;
  spendable_balance?: string;
}

export interface TransactionRecord {
  id: string;
  transaction_hash: string;
  created_at: string;
  type: string;
  amount: string | null;
  asset: string | null;
  asset_issuer: string | null;
  from: string | null;
  to: string | null;
  direction: 'received' | 'sent';
}

export interface PaymentResult {
  hash: string;
  ledger: number;
  successful: boolean;
}

interface UnsignedSendResult {
  xdr: string;
  networkPassphrase: string;
}

interface HorizonError {
  response?: {
    status: number;
  };
}

// Minimal field shapes for Stellar operation records (union-safe access)
interface OperationFields {
  id: string;
  transaction_hash: string;
  created_at: string;
  type: string;
  amount?: string;
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
  from?: string;
  to?: string;
  funder?: string;
  account?: string;
}

@Injectable()
export class StellarService {
  private readonly server: Horizon.Server;
  private readonly networkPassphrase: string;
  private readonly signerSecret?: string;

  constructor(private readonly config: ConfigService) {
    const horizonUrl =
      this.config.get<string>('STELLAR_HORIZON_URL') ??
      'https://horizon-testnet.stellar.org';

    const network = (this.config.get<string>('STELLAR_NETWORK') ??
      'testnet') as NetworkType;

    this.networkPassphrase =
      network === 'public' ? Networks.PUBLIC : Networks.TESTNET;

    this.signerSecret = this.config.get<string>('STELLAR_SIGNER_SECRET');

    this.server = new Horizon.Server(horizonUrl);
  }

  async getAccount(publicKey: string): Promise<Horizon.AccountResponse> {
    this.assertPublicKey(publicKey);
    return this.server.loadAccount(publicKey);
  }

  async getBalances(publicKey: string): Promise<BalanceRecord[]> {
    const account = await this.getAccount(publicKey);
    const root = await this.server.root().call();
    const baseReserve = Number(root.base_reserve_in_stroops) / 10_000_000;
    const subentryCount = Number(account.subentry_count ?? 0);
    const sponsoring = Number(account.num_sponsoring ?? 0);
    const sponsored = Number(account.num_sponsored ?? 0);
    const minimumReserve = Math.max(0, 2 + subentryCount + sponsoring - sponsored) * baseReserve;

    return account.balances.map((b): BalanceRecord => {
      const record: BalanceRecord = {
        asset_type: b.asset_type,
        asset_code: 'asset_code' in b ? (b.asset_code ?? null) : null,
        asset_issuer: 'asset_issuer' in b ? (b.asset_issuer ?? null) : null,
        balance: b.balance,
        limit: 'limit' in b ? (b.limit ?? null) : null,
      };
      if (b.asset_type === 'native') {
        const sellingLiabilities = Number(
          'selling_liabilities' in b ? b.selling_liabilities ?? 0 : 0,
        );
        record.minimum_reserve = minimumReserve.toFixed(7);
        record.spendable_balance = Math.max(
          0,
          Number(b.balance) - sellingLiabilities - minimumReserve,
        ).toFixed(7);
      }
      return record;
    });
  }

  async getTransactions(
    publicKey: string,
    limit = 10,
  ): Promise<TransactionRecord[]> {
    this.assertPublicKey(publicKey);

    try {
      const res = await this.server
        .payments()
        .forAccount(publicKey)
        .order('desc')
        .limit(Math.min(Math.max(limit, 1), 200))
        .call();

      return res.records.map((op): TransactionRecord => {
        const o = op as unknown as OperationFields;
        return {
          id: o.id,
          transaction_hash: o.transaction_hash,
          created_at: o.created_at,
          type: o.type,
          amount: o.amount ?? null,
          asset: o.asset_type === 'native' ? 'XLM' : (o.asset_code ?? null),
          asset_issuer: o.asset_issuer ?? null,
          from: o.from ?? o.funder ?? null,
          to: o.to ?? o.account ?? null,
          direction:
            o.to === publicKey || o.account === publicKey ? 'received' : 'sent',
        };
      });
    } catch (err: unknown) {
      const horizonErr = err as HorizonError;
      if (horizonErr?.response?.status === 404) {
        throw new AppException(
          ErrorCode.STELLAR_ACCOUNT_NOT_FOUND,
          `Account ${publicKey} not found on Stellar network.`,
        );
      }
      throw new AppException(
        ErrorCode.STELLAR_TRANSACTION_FAILED,
        'Failed to fetch transactions from Stellar network.',
      );
    }
  }

  /**
   * Sends a payment signed by the backend wallet.
   * For production, prefer client-side signing or KMS/HSM custody.
   */
  async sendPayment(params: {
    destination: string;
    amount: string;
    memo?: string;
    asset?: { code: string; issuer?: string };
  }): Promise<PaymentResult> {
    if (!this.signerSecret) {
      throw new AppException(
        ErrorCode.MISSING_SIGNER_SECRET,
        'STELLAR_SIGNER_SECRET is not configured for signing transactions.',
      );
    }

    this.assertPublicKey(params.destination);
    this.assertAmount(params.amount);

    const sourceKeypair = Keypair.fromSecret(this.signerSecret);
    const sourcePublicKey = sourceKeypair.publicKey();

    const account = await this.server.loadAccount(sourcePublicKey);
    const asset = this.buildAsset(params.asset);

    let builder = new TransactionBuilder(account, {
      fee: String(BASE_FEE),
      networkPassphrase: this.networkPassphrase,
    }).addOperation(
      Operation.payment({
        destination: params.destination,
        asset,
        amount: params.amount,
      }),
    );

    if (params.memo) {
      builder = builder.addMemo(Memo.text(params.memo));
    }

    const tx = builder.setTimeout(60).build();
    tx.sign(sourceKeypair);
    const res: Horizon.HorizonApi.SubmitTransactionResponse =
      await this.server.submitTransaction(tx);

    return {
      hash: res.hash,
      ledger: res.ledger,
      successful: res.successful,
    };
  }

  /**
   * Builds an unsigned USDC transaction with a payment to the recipient
   * and a second payment for the platform fee. The frontend signs the XDR.
   */
  async buildUnsignedUsdcSend(params: {
    sourcePublicKey: string;
    destination: string;
    amount: string;
    feeAddress: string;
    feeAmount: string;
  }): Promise<UnsignedSendResult> {
    this.assertPublicKey(params.sourcePublicKey);
    this.assertPublicKey(params.destination);
    this.assertPublicKey(params.feeAddress);
    this.assertAmount(params.amount);
    this.assertAmount(params.feeAmount);

    const usdc = this.getUsdcAsset();
    const account = await this.server.loadAccount(params.sourcePublicKey);

    const tx = new TransactionBuilder(account, {
      fee: String(BASE_FEE),
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        Operation.payment({
          destination: params.destination,
          asset: usdc,
          amount: params.amount,
        }),
      )
      .addOperation(
        Operation.payment({
          destination: params.feeAddress,
          asset: usdc,
          amount: params.feeAmount,
        }),
      )
      .setTimeout(180)
      .build();

    return {
      xdr: tx.toXDR(),
      networkPassphrase: this.networkPassphrase,
    };
  }

  /**
   * Receives an XDR already signed by the client and submits it to Stellar.
   * Translates Horizon errors into clear messages via describeHorizonError.
   */
  async submitSignedXdr(signedXdr: string): Promise<PaymentResult> {
    let tx: Transaction | FeeBumpTransaction;
    try {
      tx = TransactionBuilder.fromXDR(signedXdr, this.networkPassphrase);
    } catch {
      throw new AppException(
        ErrorCode.INVALID_AMOUNT,
        'Invalid or malformed signedXdr.',
      );
    }

    try {
      const res: Horizon.HorizonApi.SubmitTransactionResponse =
        await this.server.submitTransaction(tx);
      return {
        hash: res.hash,
        ledger: res.ledger,
        successful: res.successful,
      };
    } catch (err: unknown) {
      const horizonErr = err as HorizonError;
      throw new AppException(
        ErrorCode.STELLAR_TRANSACTION_FAILED,
        describeHorizonError(horizonErr),
      );
    }
  }

  /** Builds the USDC Asset from the configured issuer. */
  private getUsdcAsset(): Asset {
    const issuer = this.config.get<string>('TRUSTLESS_WORK_USDC_ISSUER');
    if (!issuer) {
      throw new AppException(
        ErrorCode.MISSING_ASSET_ISSUER,
        'TRUSTLESS_WORK_USDC_ISSUER is not configured for USDC operations.',
      );
    }
    this.assertPublicKey(issuer);
    return new Asset('USDC', issuer);
  }

  private buildAsset(asset?: { code: string; issuer?: string }): Asset {
    if (!asset || asset.code === 'XLM') return Asset.native();

    if (!asset.issuer) {
      throw new AppException(
        ErrorCode.MISSING_ASSET_ISSUER,
        'Non-native assets require an issuer address (e.g. the USDC issuer).',
      );
    }

    this.assertPublicKey(asset.issuer);
    return new Asset(asset.code, asset.issuer);
  }

  private assertPublicKey(key: string): void {
    if (!key || key[0] !== 'G' || key.length < 50) {
      throw new AppException(
        ErrorCode.INVALID_STELLAR_ADDRESS,
        'Invalid public key. Must start with "G" and be at least 50 characters.',
      );
    }
  }

  private assertAmount(amount: string): void {
    if (!/^\d+(\.\d{1,7})?$/.test(amount) || Number(amount) <= 0) {
      throw new AppException(
        ErrorCode.INVALID_AMOUNT,
        'Invalid amount. Use a positive number with up to 7 decimal places (e.g. "1" or "0.1234567").',
      );
    }
  }
}
