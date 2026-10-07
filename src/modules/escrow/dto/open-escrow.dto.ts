import { IsString, IsNumber, IsUUID, Min, IsOptional } from 'class-validator';

/**
 * OpenEscrowDto
 *
 * Used by POST /escrows/open — the combined initialize+fund endpoint.
 * The backend deploys the contract automatically; the client only needs
 * to sign the returned fund transaction once.
 */
export class OpenEscrowDto {
  /** UUID of the LocalSettle order this escrow protects */
  @IsUUID()
  orderId: string;

  /** Seller's Stellar public key — will fund the escrow (sign the fund tx) */
  @IsString()
  sellerAddress: string;

  /** Buyer's Stellar public key — will receive the funds on release */
  @IsString()
  buyerAddress: string;

  /** USDC amount for the escrow */
  @IsNumber()
  @Min(0.0000001)
  amount: number;

  /** Human-readable title shown on the escrow contract */
  @IsString()
  title: string;

  /** Asset code being sold (e.g., XLM, USDC, native). Defaults to USDC if omitted. */
  @IsString()
  @IsOptional()
  assetCode?: string;
}
