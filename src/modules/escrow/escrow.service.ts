/**
 * escrow.service.ts
 *
 * Business logic for the LocalSettle P2P escrow flow.
 *
 * Key facts:
 *
 *  1. ROLES — The `roles` object only includes keys accepted by the TW API
 *     multi-release schema: approver, serviceProvider, platformAddress,
 *     releaseSigner, disputeResolver.
 *
 *  2. TRUSTLINE — For non-USDC assets (XLM/native), the trustline uses the
 *     Soroban SAC contract address instead of an empty string.
 *
 *  3. ERRORS — All exceptions use AppException with a stable ErrorCode so the
 *     frontend can branch on `error.error` instead of parsing message text.
 *     HTTP status is inferred automatically from the ErrorCode.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaginationDto } from '../../common/pagination.dto';
import { CreateEscrowDto } from './dto/create-escrow.dto';
import { UpdateEscrowDto } from './dto/update-escrow.dto';
import { OpenEscrowDto } from './dto/open-escrow.dto';
import { InitializeEscrowDto } from './dto/initialize-escrow.dto';
import { FundEscrowDto } from './dto/fund-escrow.dto';
import { FiatSentDto } from './dto/fiat-sent.dto';
import { ReleaseEscrowDto } from './dto/release-escrow.dto';
import { SyncEscrowDto, EscrowAction } from './dto/sync-escrow.dto';
import { EscrowRepository } from './escrow.repository';
import { TrustlessWorkService } from './trustless-work.service';
import {
  InitializeMultiReleaseEscrowPayload,
  MultiReleaseRoles,
  Trustline,
} from './trustless-work.types';
import { EscrowOnChain, escrow_status } from '@prisma/client';
import { AppException, ErrorCode } from '../../common/errors';
import {
  FileStorageService,
  UploadFileInput,
} from '../file-storage/file-storage.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction, AuditResult } from '../audit-log/enums/audit-action.enum';

@Injectable()
export class EscrowService {
  private readonly logger = new Logger(EscrowService.name);

  constructor(
    private readonly repo: EscrowRepository,
    private readonly tw: TrustlessWorkService,
    private readonly config: ConfigService,
    private readonly fileStorage: FileStorageService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /**
   * Helper method to query on-chain balance for a given escrow contract address.
   * Encapsulates TrustlessWorkService calls to maintain separation of concerns.
   */
  async getOnChainEscrowBalance(contractId: string) {
    return this.tw.getEscrowBalance(contractId);
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private validateAssetCode(assetCode: string | undefined): void {
    const normalized = (assetCode || 'USDC').toUpperCase();
    if (normalized !== 'USDC') {
      throw new AppException(
        ErrorCode.UNSUPPORTED_ASSET,
        `Unsupported asset: "${assetCode}". Only USDC is accepted for escrow operations.`,
      );
    }
  }

  private getNetworkPassphrase(): string {
    const network = this.config
      .get<string>('STELLAR_NETWORK', 'testnet')
      .toLowerCase();
    return network === 'public'
      ? 'Public Global Stellar Network ; September 2015'
      : 'Test SDF Network ; September 2015';
  }

  private resolveTrustline(assetCode: string | undefined): Trustline {
    const isNative =
      !assetCode ||
      assetCode === 'XLM' ||
      assetCode === 'native' ||
      assetCode === '';

    if (isNative) {
      const xlmSacAddress =
        this.config.get<string>('TRUSTLESS_WORK_XLM_ADDRESS') ??
        'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
      return { address: xlmSacAddress, symbol: 'XLM' };
    }

    const usdcIssuer = this.config.getOrThrow<string>(
      'TRUSTLESS_WORK_USDC_ISSUER',
    );
    return { address: usdcIssuer, symbol: assetCode };
  }

  /**
   * Builds the `roles` object accepted by the TW multi-release deployer.
   *
   * P2P mapping:
   *   approver        → treasury (auto-approves after buyer confirms fiat)
   *   serviceProvider → buyer   (provides the fiat "service")
   *   platformAddress → treasury
   *   releaseSigner   → seller  (releases once fiat is received)
   *   disputeResolver → support
   */
  private buildP2PRoles(
    sellerAddress: string,
    buyerAddress: string,
  ): MultiReleaseRoles {
    const treasury = this.config.getOrThrow<string>('IKASH_TREASURY_ADDRESS');
    const support = this.config.getOrThrow<string>('IKASH_SUPPORT_ADDRESS');

    return {
      approver: treasury,
      serviceProvider: buyerAddress,
      platformAddress: treasury,
      releaseSigner: sellerAddress,
      disputeResolver: support,
    };
  }

  private async getOrFail(id: string): Promise<EscrowOnChain> {
    const escrow = (await this.repo.findById(id)) as EscrowOnChain;
    if (!escrow) {
      throw new AppException(
        ErrorCode.ESCROW_NOT_FOUND,
        `Escrow ${id} not found`,
      );
    }
    return escrow;
  }

  public validateStatusTransition(
    currentStatus: string,
    action: EscrowAction | string,
  ) {
    const validTransitions: Record<string, string[]> = {
      [EscrowAction.INITIALIZE]: ['pending'],
      [EscrowAction.FUND]: ['initialized'],
      [EscrowAction.FIAT_SENT]: ['funded'],
      [EscrowAction.RELEASE]: ['funded', 'fiat_sent'],
      ESCROW_CREATED: ['pending'],
      ESCROW_FUNDED: ['initialized'],
      ESCROW_RELEASED: ['funded', 'fiat_sent'],
      ESCROW_REFUNDED: ['funded', 'fiat_sent', 'disputed'],
      ESCROW_CANCELLED: ['pending', 'initialized'],
      ESCROW_DISPUTED: ['funded', 'fiat_sent'],
    };

    const allowed = validTransitions[action];
    if (!allowed || !allowed.includes(currentStatus)) {
      throw new AppException(
        ErrorCode.ESCROW_INVALID_STATUS,
        `Invalid state transition: cannot "${action}" from status "${currentStatus}". ` +
          `Expected one of: [${allowed?.join(', ')}]`,
      );
    }
  }

  // ─── Trustless Work Escrow Flow ────────────────────────────────────────────

  /**
   * PURE CHAIN OPERATION: Deploy escrow contract + build unsigned fund XDR.
   *
   * Does NOT read or write to the database. Intended to be called by
   * OrderService.create() so the escrow is deployed before any DB record is saved.
   */
  async deployEscrowToChain(
    orderId: string,
    dto: Pick<
      OpenEscrowDto,
      'sellerAddress' | 'buyerAddress' | 'amount' | 'assetCode' | 'title'
    >,
  ): Promise<{ contractId: string; unsignedFundTransaction: string }> {
    this.validateAssetCode(dto.assetCode);

    const treasury = this.config.getOrThrow<string>('IKASH_TREASURY_ADDRESS');
    const deployerSecret = this.config.getOrThrow<string>(
      'IKASH_DEPLOYER_SECRET',
    );
    const platformFee = Number(
      this.config.get<string>('IKASH_PLATFORM_FEE', '1'),
    );

    const deployPayload: InitializeMultiReleaseEscrowPayload = {
      signer: treasury,
      engagementId: orderId,
      title: dto.title ?? `LocalSettle P2P Order ${orderId}`,
      description: `LocalSettle P2P escrow for order ${orderId}`,
      roles: this.buildP2PRoles(dto.sellerAddress, dto.buyerAddress),
      platformFee,
      milestones: [
        {
          description: 'P2P fiat-to-crypto exchange',
          amount: Number(dto.amount),
          receiver: dto.buyerAddress,
        },
      ],
      trustline: this.resolveTrustline(dto.assetCode),
    };

    const deployResult = await this.tw.initializeEscrow(deployPayload);

    const broadcastResult = await this.tw.signAndBroadcast(
      deployResult.unsignedTransaction,
      deployerSecret,
      this.getNetworkPassphrase(),
    );

    if (broadcastResult.status !== 'SUCCESS' || !broadcastResult.contractId) {
      throw new AppException(
        ErrorCode.ESCROW_CREATION_FAILED,
        broadcastResult.message ?? 'Escrow contract deployment failed',
      );
    }

    const { contractId } = broadcastResult;
    this.logger.log(
      `Escrow deployed: contractId=${contractId} for order ${orderId}`,
    );

    const fundResult = await this.tw.fundEscrow({
      contractId,
      signer: dto.sellerAddress,
      amount: Number(dto.amount),
    });

    return {
      contractId,
      unsignedFundTransaction: fundResult.unsignedTransaction,
    };
  }

  async open(dto: OpenEscrowDto) {
    const existing = await this.repo.findByOrder(dto.orderId);
    if (existing?.contractId) {
      throw new AppException(
        ErrorCode.ESCROW_ALREADY_EXISTS,
        'An escrow contract already exists for this order',
      );
    }

    const { contractId, unsignedFundTransaction } =
      await this.deployEscrowToChain(dto.orderId, dto);

    let escrow = existing;
    const isNewEscrow = !escrow;
    if (!escrow) {
      escrow = (await this.repo.create({
        orderId: dto.orderId,
        buyerAddress: dto.buyerAddress,
        sellerAddress: dto.sellerAddress,
        amount: dto.amount,
        escrowStatus: 'initialized',
      })) as EscrowOnChain;
    }
    await this.repo.update(escrow.escrowId, {
      contractId,
      escrowStatus: 'initialized',
    });

    if (isNewEscrow) {
      await this.auditLogService.create({
        action: AuditAction.ESCROW_CREATED,
        resourceType: 'Escrow',
        resourceId: escrow.escrowId,
        result: AuditResult.SUCCESS,
        metadata: { orderId: dto.orderId, contractId },
      });
    }

    return {
      escrowId: escrow.escrowId,
      contractId,
      unsignedFundTransaction,
    };
  }

  async initialize(dto: InitializeEscrowDto) {
    this.validateAssetCode(dto.assetCode);

    const existing = await this.repo.findByOrder(dto.orderId);
    if (existing?.contractId) {
      throw new AppException(
        ErrorCode.ESCROW_ALREADY_EXISTS,
        'An escrow contract already exists for this order',
      );
    }

    const platformFee = Number(
      this.config.get<string>('IKASH_PLATFORM_FEE', '1'),
    );

    const payload: InitializeMultiReleaseEscrowPayload = {
      signer: dto.signerAddress,
      engagementId: dto.orderId,
      title: dto.title,
      description: `LocalSettle P2P escrow for order ${dto.orderId}`,
      roles: this.buildP2PRoles(dto.sellerAddress, dto.buyerAddress),
      platformFee,
      milestones: [
        {
          description: 'P2P fiat-to-crypto exchange',
          amount: Number(dto.amount),
          receiver: dto.buyerAddress,
        },
      ],
      trustline: this.resolveTrustline(dto.assetCode),
    };

    const result = await this.tw.initializeEscrow(payload);
    let escrow = await this.repo.findByOrder(dto.orderId);
    const isNewEscrow = !escrow;
    if (!escrow) {
      escrow = (await this.repo.create({
        orderId: dto.orderId,
        buyerAddress: dto.buyerAddress,
        sellerAddress: dto.sellerAddress,
        amount: dto.amount,
        escrowStatus: 'pending',
      })) as EscrowOnChain;
    } else {
      await this.repo.update(escrow.escrowId, {
        buyerAddress: dto.buyerAddress,
        sellerAddress: dto.sellerAddress,
        amount: dto.amount,
      });
    }

    if (isNewEscrow) {
      await this.auditLogService.create({
        action: AuditAction.ESCROW_CREATED,
        resourceType: 'Escrow',
        resourceId: escrow.escrowId,
        result: AuditResult.SUCCESS,
        metadata: { orderId: dto.orderId },
      });
    }
    return {
      escrowId: escrow?.escrowId,
      unsignedTransaction: result.unsignedTransaction,
    };
  }

  async fund(dto: FundEscrowDto) {
    const escrow = await this.getOrFail(dto.escrowId);

    if (!escrow.contractId) {
      throw new AppException(
        ErrorCode.ESCROW_NOT_INITIALIZED,
        'Escrow has not been initialized on-chain yet. Complete the initialize step first.',
      );
    }
    if (escrow.escrowStatus !== 'initialized') {
      throw new AppException(
        ErrorCode.ESCROW_INVALID_STATUS,
        `Cannot fund escrow in status "${escrow.escrowStatus}". Must be "initialized".`,
      );
    }

    const result = await this.tw.fundEscrow({
      contractId: escrow.contractId,
      signer: dto.signerAddress,
      amount: Number(dto.amount),
    });

    return {
      escrowId: escrow.escrowId,
      unsignedTransaction: result.unsignedTransaction,
    };
  }

  async markFiatSent(id: string, dto: FiatSentDto) {
    const escrow = await this.getOrFail(id);

    if (!['funded', 'fiat_sent'].includes(escrow.escrowStatus)) {
      throw new AppException(
        ErrorCode.ESCROW_INVALID_STATUS,
        `Cannot mark fiat sent for escrow in status "${escrow.escrowStatus}". Must be "funded" or "fiat_sent".`,
      );
    }

    const result = await this.tw.changeMilestoneStatus({
      contractId: escrow.contractId!,
      serviceProvider: dto.buyerAddress,
      milestoneIndex: '0',
      newStatus: 'completed',
      newEvidence: dto.evidence || 'Fiat payment sent by buyer',
    });

    return {
      escrowId: escrow.escrowId,
      unsignedTransaction: result.unsignedTransaction,
    };
  }

  async uploadEvidence(id: string, file?: UploadFileInput) {
    if (!file || !file.buffer) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'Evidence file is required',
      );
    }

    const allowedMimes = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf',
    ];
    if (!allowedMimes.includes(file.mimetype)) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        `Invalid file type "${file.mimetype}". Allowed: ${allowedMimes.join(', ')}`,
      );
    }

    const escrow = await this.getOrFail(id);
    const ext = file.originalname.split('.').pop() || 'jpg';
    const key = `evidence/${escrow.escrowId}/${Date.now()}.${ext}`;

    const result = await this.fileStorage.uploadFile({
      originalname: file.originalname,
      mimetype: file.mimetype,
      buffer: file.buffer,
      size: file.size,
      key,
    });

    await this.repo.update(id, { evidenceUrl: result.url });

    return { url: result.url };
  }

  async release(dto: ReleaseEscrowDto) {
    const escrow = await this.getOrFail(dto.escrowId);

    if (!escrow.contractId) {
      throw new AppException(
        ErrorCode.ESCROW_NO_CONTRACT,
        'Escrow has no on-chain contract',
      );
    }
    if (!['funded', 'fiat_sent'].includes(escrow.escrowStatus)) {
      throw new AppException(
        ErrorCode.ESCROW_INVALID_STATUS,
        `Cannot release escrow in status "${escrow.escrowStatus}". Must be "funded" or "fiat_sent".`,
      );
    }

    const statusRes = await this.tw.getEscrowByContractId(
      escrow.contractId,
      true,
    );
    const milestoneState = statusRes?.[0]?.milestones?.[0]?.status;

    if (milestoneState === 'completed') {
      this.logger.log(
        `Auto-approving milestone for escrow ${dto.escrowId} before release…`,
      );
      const treasury = this.config.getOrThrow<string>('IKASH_TREASURY_ADDRESS');
      const treasurySecret = this.config.getOrThrow<string>(
        'IKASH_DEPLOYER_SECRET',
      );

      const approveXdr = await this.tw.approveMilestone({
        contractId: escrow.contractId,
        approver: treasury,
        milestoneIndex: '0',
      });

      const broadcastResult = await this.tw.signAndBroadcast(
        approveXdr.unsignedTransaction,
        treasurySecret,
        this.getNetworkPassphrase(),
      );

      if (broadcastResult.status !== 'SUCCESS') {
        throw new AppException(
          ErrorCode.ESCROW_APPROVE_FAILED,
          `Auto-approve failed: ${broadcastResult.message}`,
        );
      }
    }

    const result = await this.tw.releaseMilestoneFunds({
      contractId: escrow.contractId,
      releaseSigner: dto.releaseSigner,
      milestoneIndex: '0',
    });

    return {
      escrowId: escrow.escrowId,
      unsignedTransaction: result.unsignedTransaction,
    };
  }

  async syncTransaction(dto: SyncEscrowDto) {
    const escrow = await this.getOrFail(dto.escrowId);

    this.validateStatusTransition(escrow.escrowStatus, dto.action);

    const result = await this.tw.sendTransaction(dto.signedXdr);
    if (result.status !== 'SUCCESS') {
      throw new AppException(
        ErrorCode.ESCROW_SYNC_FAILED,
        `Blockchain sync failed: ${result.message || 'Unknown error'}`,
      );
    }

    const updateData: Record<string, unknown> = {};
    switch (dto.action) {
      case EscrowAction.INITIALIZE:
        updateData.escrowStatus = 'initialized';
        if (result.contractId) updateData.contractId = result.contractId;
        updateData.txHashLock = dto.signedXdr.substring(0, 64);
        break;
      case EscrowAction.FUND:
        updateData.escrowStatus = 'funded';
        break;
      case EscrowAction.FIAT_SENT:
        updateData.escrowStatus = 'fiat_sent';
        break;
      case EscrowAction.RELEASE:
        updateData.escrowStatus = 'released';
        updateData.txHashRelease = dto.signedXdr.substring(0, 64);
        break;
    }
    await this.repo.update(dto.escrowId, updateData);

    if (dto.action === EscrowAction.FUND) {
      await this.auditLogService.create({
        action: AuditAction.ESCROW_FUNDED,
        resourceType: 'Escrow',
        resourceId: dto.escrowId,
        result: AuditResult.SUCCESS,
        metadata: { contractId: result.contractId ?? escrow.contractId },
      });
    } else if (dto.action === EscrowAction.RELEASE) {
      await this.auditLogService.create({
        action: AuditAction.ESCROW_RELEASED,
        resourceType: 'Escrow',
        resourceId: dto.escrowId,
        result: AuditResult.SUCCESS,
        metadata: {
          contractId: result.contractId ?? escrow.contractId,
          txHashRelease: updateData.txHashRelease,
        },
      });
    }

    return {
      escrowId: dto.escrowId,
      status: result.status,
      contractId: result.contractId ?? escrow.contractId,
      newEscrowStatus: updateData.escrowStatus,
    };
  }

  async getStatus(id: string) {
    const escrow = await this.getOrFail(id);

    const response: Record<string, unknown> = {
      ...escrow,
      onChainBalance: null,
      onChainData: null,
    };

    if (escrow.contractId) {
      try {
        const [balanceRes, onChainRes] = await Promise.allSettled([
          this.tw.getEscrowBalance(escrow.contractId),
          this.tw.getEscrowByContractId(escrow.contractId, true),
        ]);

        if (balanceRes.status === 'fulfilled') {
          response.onChainBalance = balanceRes.value;
        }
        if (onChainRes.status === 'fulfilled') {
          response.onChainData = onChainRes.value;
        }
      } catch (err) {
        this.logger.warn(
          `Could not fetch on-chain data for escrow ${id}: ${err}`,
        );
      }
    }

    return response;
  }

  // ─── Legacy CRUD ──────────────────────────────────────────────────────────

  async create(dto: CreateEscrowDto) {
    const exists = await this.repo.findByOrder(dto.orderId);
    if (exists) {
      throw new AppException(
        ErrorCode.ESCROW_ALREADY_EXISTS,
        'An escrow already exists for this order',
      );
    }
    return this.repo.create(
      dto as unknown as Record<string, unknown>,
    ) as Promise<EscrowOnChain>;
  }

  list(p: PaginationDto, orderId?: string) {
    if (orderId) {
      return this.repo.findMany({
        skip: p.skip,
        take: p.take,
        where: { orderId },
      });
    }
    return this.repo.findMany({ skip: p.skip, take: p.take });
  }

  async get(id: string) {
    const item = await this.repo.findById(id);
    if (!item) {
      throw new AppException(
        ErrorCode.ESCROW_NOT_FOUND,
        `Escrow ${id} not found`,
      );
    }
    return item;
  }

  update(id: string, dto: UpdateEscrowDto) {
    return this.repo.update(id, dto as unknown as Record<string, unknown>);
  }

  remove(id: string) {
    return this.repo.delete(id);
  }

  /**
   * Checks if an escrow status transition for a given event is terminal or already processed.
   */
  isTerminalOrAlreadyProcessed(
    currentStatus: escrow_status,
    eventType: string,
  ): boolean {
    if (eventType === 'ESCROW_CREATED' && currentStatus !== 'pending') {
      return true;
    }
    if (
      eventType === 'ESCROW_FUNDED' &&
      ['funded', 'fiat_sent', 'released', 'resolved'].includes(currentStatus)
    ) {
      return true;
    }
    if (
      eventType === 'ESCROW_RELEASED' &&
      ['released', 'resolved'].includes(currentStatus)
    ) {
      return true;
    }
    if (
      eventType === 'ESCROW_REFUNDED' &&
      ['resolved'].includes(currentStatus)
    ) {
      return true;
    }
    if (
      eventType === 'ESCROW_CANCELLED' &&
      ['resolved', 'released'].includes(currentStatus)
    ) {
      return true;
    }
    if (eventType === 'ESCROW_DISPUTED' && currentStatus === 'disputed') {
      return true;
    }

    return false;
  }

  /**
   * Updates an escrow's status and transaction hashes from on-chain event synchronization.
   */
  async updateStatusFromOnChain(
    escrowId: string,
    newStatus: escrow_status,
    txHash?: string,
    eventType?: string,
  ): Promise<EscrowOnChain> {
    const updateData: Record<string, unknown> = {
      escrowStatus: newStatus,
    };
    if (eventType === 'ESCROW_FUNDED' && txHash) {
      updateData.txHashLock = txHash;
    }
    if (
      (eventType === 'ESCROW_RELEASED' || eventType === 'ESCROW_REFUNDED') &&
      txHash
    ) {
      updateData.txHashRelease = txHash;
    }
    return this.repo.update(
      escrowId,
      updateData,
    ) as unknown as Promise<EscrowOnChain>;
  }
}
