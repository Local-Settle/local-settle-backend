import { IsString, IsNumber, IsUUID, Min } from 'class-validator';

export class FundEscrowDto {
  /** LocalSettle escrow record ID */
  @IsUUID()
  escrowId: string;

  /** Stellar public key of the entity funding the escrow */
  @IsString()
  signerAddress: string;

  /** USDC amount to deposit */
  @IsNumber()
  @Min(0.0000001)
  amount: number;
}
