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
   * Decode, sign, and re-encode the envelope through the Stellar SDK so XDR
   * parsing and decorated-signature serialization stay aligned with the SDK.
   *
   * SECURITY: signerSecret must come from a backend env var, never from the client.
   */
  async signAndBroadcast(
    unsignedXdr: string,
    signerSecret: string,
    networkPassphrase: string,
  ): Promise<SendTransactionResponse> {
    const keypair = StellarSdk.Keypair.fromSecret(signerSecret);
    const transaction = StellarSdk.TransactionBuilder.fromXDR(
      unsignedXdr,
      networkPassphrase,
    );
    transaction.sign(keypair);
    const signedXdr = transaction.toXDR();

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
    try {
      const res = await this.http.get<T>(url, config);
      return res.data;
    } catch (err) {
      this.handleError(err, `GET ${url}`);
    }
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
