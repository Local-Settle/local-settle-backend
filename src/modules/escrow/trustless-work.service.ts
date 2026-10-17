/**
 * trustless-work.service.ts
 *
 * HTTP client for the Trustless Work REST API.
 *
 * Changes from the original version:
 *  - All payloads now use the canonical types from trustless-work.types.ts
 *  - `roles` is a plain object with the exact keys the API expects
 *    (no `client` key — that field does not exist in the TW schema)
 *  - `trustline` is always an object { address, symbol }; never null/undefined
 *  - `initializeEscrow` param type now enforces `MultiReleaseRoles` directly,
 *    eliminating the `Record<string, string>` footgun
 *  - Response types are explicit instead of `any`
 *
 * SECURITY: This service NEVER handles private keys except in signAndBroadcast,
 * which must only be called with secrets sourced from env vars.
 */

import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosError } from 'axios';
import { AppException, ErrorCode } from '../../common/errors';
import * as StellarSdk from '@stellar/stellar-sdk';
import {
  InitializeMultiReleaseEscrowPayload,
  FundEscrowPayload,
  ChangeMilestoneStatusPayload,
  ApproveMilestonePayload,
  ReleaseMilestoneFundsPayload,
  UnsignedTransactionResponse,
  SendTransactionResponse,
  EscrowIndexerEntry,
  EscrowBalanceResponse,
} from './trustless-work.types';

@Injectable()
export class TrustlessWorkService {
  private readonly http: AxiosInstance;
  private readonly logger = new Logger(TrustlessWorkService.name);
  private consecutiveReadFailures = 0;
  private readCircuitOpenedAt = 0;

  constructor(private readonly config: ConfigService) {
    const baseURL =
      this.config.get<string>('TRUSTLESS_WORK_API_URL') ??
      'https://api.trustlesswork.com';
    const apiKey =
      this.config.get<string>('TRUSTLESS_WORK_API_KEY') ?? 'mock-key';

    this.http = axios.create({
      baseURL,
      timeout: 60_000,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
    });

    // Log outgoing payloads in debug mode so validation errors are easy to diagnose
    this.http.interceptors.request.use((req) => {
      this.logger.debug(
        `TW → ${req.method?.toUpperCase()} ${req.url}\n${JSON.stringify(req.data, null, 2)}`,
      );
      return req;
    });
  }

  // ─── Deploy ────────────────────────────────────────────────────────────────

  /**
   * POST /deployer/multi-release
   *
   * Builds an unsigned XDR that deploys a new multi-release escrow contract.
   * The caller must sign and broadcast via sendTransaction().
   *
   * API required fields: signer, engagementId, title, description,
   *                       roles, platformFee, milestones, trustline
   *
   * Roles must be a plain object — never an array or a Record<string,string>.
   * Valid keys: approver, serviceProvider, platformAddress, releaseSigner, disputeResolver
   *
   * Trustline must be { address: string, symbol: string } — never null.
   * For native XLM use { address: '', symbol: 'XLM' }.
   */
  async initializeEscrow(
    payload: InitializeMultiReleaseEscrowPayload,
  ): Promise<UnsignedTransactionResponse> {
    const assetSymbol = payload.trustline?.symbol?.toUpperCase();
    if (assetSymbol !== 'USDC') {
      throw new AppException(
        ErrorCode.UNSUPPORTED_ASSET,
        `Only USDC is supported for escrow. Received: "${payload.trustline?.symbol}"`,
      );
    }
    return this.post<UnsignedTransactionResponse>(
      '/deployer/multi-release',
      payload,
    );
  }

  // ─── Fund ──────────────────────────────────────────────────────────────────

  /**
   * POST /escrow/multi-release/fund-escrow
   *
   * Builds an unsigned XDR for the seller to fund the escrow.
   * `amount` should equal the sum of all milestone amounts.
   */
  async fundEscrow(
    payload: FundEscrowPayload,
  ): Promise<UnsignedTransactionResponse> {
    return this.post<UnsignedTransactionResponse>(
      '/escrow/multi-release/fund-escrow',
      payload,
    );
  }

  // ─── Milestone ─────────────────────────────────────────────────────────────

  /**
   * POST /escrow/multi-release/change-milestone-status
   *
   * Service provider marks a milestone as completed and attaches evidence.
   * `newEvidence` is required by the API schema (use a placeholder if not applicable).
   */
  async changeMilestoneStatus(
    payload: ChangeMilestoneStatusPayload,
  ): Promise<UnsignedTransactionResponse> {
    return this.post<UnsignedTransactionResponse>(
      '/escrow/multi-release/change-milestone-status',
      payload,
    );
  }

  /**
   * POST /escrow/multi-release/approve-milestone
   *
   * Approver validates completed milestone work.
   * Must be called before releaseMilestoneFunds when milestone status is 'completed'.
   */
  async approveMilestone(
    payload: ApproveMilestonePayload,
  ): Promise<UnsignedTransactionResponse> {
    return this.post<UnsignedTransactionResponse>(
      '/escrow/multi-release/approve-milestone',
      payload,
    );
  }

  /**
   * POST /escrow/multi-release/release-milestone-funds
   *
   * Releases funds for an approved milestone to the milestone's receiver address.
   */
  async releaseMilestoneFunds(
    payload: ReleaseMilestoneFundsPayload,
  ): Promise<UnsignedTransactionResponse> {
    return this.post<UnsignedTransactionResponse>(
      '/escrow/multi-release/release-milestone-funds',
      payload,
    );
  }

  // ─── Broadcast ─────────────────────────────────────────────────────────────

  /**
   * POST /helper/send-transaction
   *
   * Broadcasts a client-signed XDR to the Stellar network.
   * This is the ONLY operation that actually executes on-chain.
   *
   * Response shape:
   *   - Deploy tx success → { status, contractId, escrow }
   *   - Other tx success  → { status, message }
   */
  async sendTransaction(signedXdr: string): Promise<SendTransactionResponse> {
    return this.post<SendTransactionResponse>('/helper/send-transaction', {
      signedXdr,
    });
  }

  /**
   * Sign an unsigned XDR with a backend-controlled secret key and broadcast it.
   *
   * Works at the raw byte level to avoid "Bad union switch" errors caused by
   * stellar-sdk not supporting the latest Soroban XDR types. We never parse
   * the inner transaction — only slice bytes, compute the hash, and inject
   * our signature.
   *
   * SECURITY: signerSecret must come from a backend env var, never from the client.
   */
  async signAndBroadcast(
    unsignedXdr: string,
    signerSecret: string,
    networkPassphrase: string,
  ): Promise<SendTransactionResponse> {
    const keypair = StellarSdk.Keypair.fromSecret(signerSecret);
    const raw = Buffer.from(unsignedXdr, 'base64');

    const envelopeTypeValue = raw.readUInt32BE(0);
    const sigCount = raw.readUInt32BE(raw.length - 4);

    if (sigCount !== 0) {
      this.logger.warn(
        `Envelope already has ${sigCount} signature(s) — appending ours`,
      );
    }

    const txBodyBytes = raw.subarray(4, raw.length - 4);

    const networkId = StellarSdk.hash(Buffer.from(networkPassphrase));
    const typeTag = Buffer.alloc(4);
    typeTag.writeUInt32BE(envelopeTypeValue, 0);

    const hashPreimage = Buffer.concat([networkId, typeTag, txBodyBytes]);
    const txHash = StellarSdk.hash(hashPreimage);

    const signature = keypair.sign(txHash);
    const hint = keypair.signatureHint();

    // DecoratedSignature XDR: hint(4) + length_prefix(4) + signature(64)
    const decoratedSig = Buffer.alloc(4 + 4 + 64);
    hint.copy(decoratedSig, 0);
    decoratedSig.writeUInt32BE(64, 4);
    signature.copy(decoratedSig, 8);

    const newSigCount = Buffer.alloc(4);
    newSigCount.writeUInt32BE(sigCount + 1, 0);

    let signedEnvelope: Buffer;

    if (sigCount > 0) {
      // Each decorated signature = 4 (hint) + 4 (len prefix) + 64 (sig) = 72 bytes
      const existingSigsLength = sigCount * 72;
      const existingSigs = raw.subarray(
        raw.length - 4 - existingSigsLength,
        raw.length - 4,
      );
      const txEnd = raw.length - 4 - existingSigsLength;

      signedEnvelope = Buffer.concat([
        raw.subarray(0, 4), // envelope type
        raw.subarray(4, txEnd), // tx body
        newSigCount, // updated sig count
        existingSigs, // existing signatures
        decoratedSig, // our new signature
      ]);
    } else {
      signedEnvelope = Buffer.concat([
        raw.subarray(0, 4), // envelope type
        txBodyBytes, // tx body
        newSigCount, // sig count = 1
        decoratedSig, // our signature
      ]);
    }

    const signedXdr = signedEnvelope.toString('base64');

    this.logger.debug(
      `Broadcasting backend-signed tx for signer ${keypair.publicKey().substring(0, 8)}…`,
    );

    return this.sendTransaction(signedXdr);
  }

  // ─── Query ─────────────────────────────────────────────────────────────────

  /**
   * GET /helper/get-escrow-by-contract-ids?contractIds[]=…&validateOnChain=…
   */
  async getEscrowByContractId(
    contractId: string,
    validateOnChain = false,
  ): Promise<EscrowIndexerEntry[]> {
    const params = new URLSearchParams();
    params.append('contractIds[]', contractId);
    params.append('validateOnChain', String(validateOnChain));

    return this.get<EscrowIndexerEntry[]>(
      `/helper/get-escrow-by-contract-ids?${params.toString()}`,
    );
  }

  /**
   * GET /helper/get-multiple-escrow-balance?addresses=…
   */
  async getEscrowBalance(
    contractAddress: string,
  ): Promise<EscrowBalanceResponse[]> {
    return this.get<EscrowBalanceResponse[]>(
      '/helper/get-multiple-escrow-balance',
      { params: { addresses: [contractAddress] } },
    );
  }

  // ─── HTTP helpers ──────────────────────────────────────────────────────────

  private async post<T>(url: string, data: unknown): Promise<T> {
    try {
      const res = await this.http.post<T>(url, data);
      return res.data;
    } catch (err) {
      this.handleError(err, `POST ${url}`);
    }
  }

  private async get<T>(url: string, config?: object): Promise<T> {
    const circuitCooldownMs = 30_000;
    if (this.readCircuitOpenedAt && Date.now() - this.readCircuitOpenedAt < circuitCooldownMs) {
      throw new AppException(
        ErrorCode.ESCROW_CREATION_FAILED,
        'Trustless Work is temporarily unavailable. Retry the read request later.',
      );
    }

    // GET requests are safe to retry. POST calls use `post()` and are never
    // retried because some endpoints create or broadcast transactions.
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const res = await this.http.get<T>(url, config);
        this.consecutiveReadFailures = 0;
        this.readCircuitOpenedAt = 0;
        return res.data;
      } catch (err) {
        const status = err instanceof AxiosError ? err.response?.status : undefined;
        const retryable =
          err instanceof AxiosError &&
          (status === undefined || status === 429 || status >= 500);

        if (!retryable || attempt === maxAttempts) {
          if (retryable) {
            this.consecutiveReadFailures += 1;
            if (this.consecutiveReadFailures >= 3) {
              this.readCircuitOpenedAt = Date.now();
            }
          }
          this.handleError(err, `GET ${url}`);
        }

        if (retryable) {
          this.consecutiveReadFailures += 1;
          if (this.consecutiveReadFailures >= 3) {
            this.readCircuitOpenedAt = Date.now();
          }
        }
        await new Promise((resolve) => setTimeout(resolve, attempt * 100));
      }
    }

    throw new AppException(
      ErrorCode.ESCROW_CREATION_FAILED,
      'Trustless Work read request failed.',
    );
  }

  private handleError(err: unknown, context: string): never {
    if (err instanceof AxiosError) {
      const status = err.response?.status ?? HttpStatus.BAD_GATEWAY;
      const responseData = err.response?.data as
        | { message?: string; error?: string }
        | undefined;

      this.logger.error(
        `Trustless Work API error [${context}]\n` +
          `  Status : ${status}\n` +
          `  Body   : ${JSON.stringify(responseData, null, 2)}\n` +
          `  Message: ${err.message}`,
      );

      const message =
        responseData?.message ?? responseData?.error ?? err.message;

      throw new AppException(
        ErrorCode.ESCROW_CREATION_FAILED,
        `Escrow operation failed: ${message}`,
      );
    }

    this.logger.error(`Unexpected error [${context}]:`, err);
    throw new AppException(
      ErrorCode.INTERNAL_SERVER_ERROR,
      'Unexpected error communicating with Trustless Work',
    );
  }
}
