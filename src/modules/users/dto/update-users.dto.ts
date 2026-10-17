import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
} from 'class-validator';
import { ALIAS_REGEX } from '../../../lib/constants/regex';

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

  @IsOptional()
  @IsBoolean()
  messageReceiptsEnabled?: boolean;
}
