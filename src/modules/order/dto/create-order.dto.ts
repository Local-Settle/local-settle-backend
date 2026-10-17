import {
  IsIn,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateOrderDto {
  @IsUUID()
  offerId: string;

  @IsUUID()
  buyerId: string;

  @IsUUID()
  sellerId: string;

  @IsNumberString()
  assetAmount: string;

  // Accepted temporarily for old clients; persistence derives the total from
  // the offer's current price and assetAmount instead of trusting this value.
  @IsOptional()
  @IsNumberString()
  fiatAmount?: string;

  @IsOptional()
  @IsIn(['created', 'locked', 'released', 'cancelled', 'expired', 'disputed'])
  orderStatus?:
    | 'created'
    | 'locked'
    | 'released'
    | 'cancelled'
    | 'expired'
    | 'disputed';

  @IsOptional()
  expiresAt?: string; // ISO string

  // ─── Escrow fields (required for atomic order+escrow creation) ───────────
  @IsString()
  @IsNotEmpty()
  sellerAddress: string;

  @IsString()
  @IsNotEmpty()
  buyerAddress: string;

  @IsString()
  @IsNotEmpty()
  assetCode: string;

  @IsOptional()
  @IsString()
  title?: string;
}
