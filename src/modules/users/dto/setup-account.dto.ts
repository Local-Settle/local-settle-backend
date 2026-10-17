import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  IsIn,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { SUPPORTED_CURRENCY_CODES } from '../../../lib/currency-metadata';

export class SetupAccountDto {
  // Stage 1
  @IsOptional()
  @IsString()
  @MaxLength(80)
  alias?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  username?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  // Stage 2
  @IsOptional()
  @IsBoolean()
  notificationsEnabled?: boolean;

  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsIn(SUPPORTED_CURRENCY_CODES, {
    message: 'preferredCurrency must be a supported ISO 4217 currency code',
  })
  preferredCurrency?: string;

  // Stage 3 (Legacy)
  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsString()
  accountHolderName?: string;

  @IsOptional()
  @IsString()
  accountNumber?: string;

  // Stage 3 (New)
  @IsOptional()
  @IsString()
  providerId?: string;

  @IsOptional()
  @IsString()
  accountIdentifier?: string;

  @IsOptional()
  @IsString()
  identificationNumber?: string;

  @IsOptional()
  @IsString()
  beneficiaryName?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
