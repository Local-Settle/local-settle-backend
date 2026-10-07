import { IsString, IsUUID, IsOptional } from 'class-validator';

/**
 * CompleteEscrowDto
 *
 * NOTE: Este DTO no está conectado a ningún endpoint activo en EscrowController.
 * La operación equivalente se maneja via POST /escrows/:id/fiat-sent con FiatSentDto.
 *
 * Si en el futuro se agrega un endpoint POST /escrows/:id/complete independiente
 * (por ejemplo para flujos no-P2P donde el serviceProvider es externo), usar este DTO.
 *
 * Rol P2P aclarado: en LocalSettle el `serviceProvider` en TW es el BUYER
 * (quien provee el fiat), NO el seller.
 */
export class CompleteEscrowDto {
  /** LocalSettle escrow record ID */
  @IsUUID()
  escrowId: string;

  /**
   * Stellar public key of the service provider marking the milestone as complete.
   *
   * P2P context: this is the BUYER's address — the buyer is the serviceProvider
   * in the TW contract because they deliver the fiat payment.
   * The seller is the releaseSigner (releases crypto once fiat is confirmed).
   */
  @IsString()
  serviceProvider: string;

  /** Optional evidence hash or link (e.g. CID from IPFS, or just a receipt string) */
  @IsOptional()
  @IsString()
  evidence?: string;
}
