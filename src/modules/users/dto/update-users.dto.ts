import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
  IsIn,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ALIAS_REGEX } from '../../../lib/constants/regex';
import { SUPPORTED_CURRENCY_CODES } from '../../../lib/currency-metadata';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(ALIAS_REGEX, {
    message:
      'Alias must only contain lowercase letters, numbers, and allowed symbols (., !, _)',
  })
  alias?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  username?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

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

  @IsOptional()
  @IsBoolean()
  pendingAccountInfo?: boolean;

  @IsOptional()
  @IsString()
  kycStatus?:
    | 'not_started'
    | 'in_progress'
    | 'in_review'
    | 'approved'
    | 'rejected'
    | 'expired'
    | 'kyc_expired'
    | 'abandoned'
    | 'resubmitted'
    | 'pending';

  @IsOptional()
  @IsString()
  @MaxLength(250)
  bio?: string;

  @IsOptional()
  @IsBoolean()
  securityUpdates?: boolean;
}
