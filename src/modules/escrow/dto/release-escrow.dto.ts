import { IsString, IsUUID } from 'class-validator';

export class ReleaseEscrowDto {
  /** LocalSettle escrow record ID */
  @IsUUID()
  escrowId: string;

  /** Stellar public key of the release signer (seller confirms fiat receipt) */
  @IsString()
  releaseSigner: string;
}
