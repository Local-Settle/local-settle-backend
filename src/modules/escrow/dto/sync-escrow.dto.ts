import { IsEnum, IsString, IsUUID } from 'class-validator';

export enum EscrowAction {
  INITIALIZE = 'initialize',
  FUND = 'fund',
  FIAT_SENT = 'fiat_sent',
  RELEASE = 'release',
}

export class SyncEscrowDto {
  /** LocalSettle escrow record ID */
  @IsUUID()
  escrowId: string;

  /** The signed XDR from the client wallet */
  @IsString()
  signedXdr: string;

  /** Which escrow operation this signed tx corresponds to */
  @IsEnum(EscrowAction)
  action: EscrowAction;
}
