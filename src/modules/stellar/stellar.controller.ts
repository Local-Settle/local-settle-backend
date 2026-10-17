import {
  Controller,
  Get,
  Param,
  Query,
  Post,
  Body,
  UseGuards,
} from '@nestjs/common';
import { StellarService } from './stellar.service';
import { SendPaymentDto } from './dto/send-payment';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SetupCompleteGuard } from '../auth/setup-complete.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('stellar')
export class StellarController {
  constructor(private readonly stellar: StellarService) {}

  @Get('account/:publicKey')
  getAccount(@Param('publicKey') publicKey: string) {
    return this.stellar.getAccount(publicKey);
  }

  @Get('balances/:publicKey')
  getBalances(@Param('publicKey') publicKey: string) {
    return this.stellar.getBalances(publicKey);
  }

  /**
   * Returns the latest payment transactions for the authenticated user's wallet.
   * The public key is resolved from the JWT token.
   * @param limit - Number of transactions to return (default: 10, max: 200)
   */
  @UseGuards(JwtAuthGuard, SetupCompleteGuard)
  @Get('transactions')
  getMyTransactions(
    @CurrentUser() user: { publicKey: string },
    @Query('limit') limit?: string,
  ) {
    return this.stellar.getTransactions(
      user.publicKey,
      limit ? Number(limit) : 10,
    );
  }

  @Get('transactions/:publicKey')
  getTxs(
    @Param('publicKey') publicKey: string,
    @Query('limit') limit?: string,
  ) {
    return this.stellar.getTransactions(publicKey, limit ? Number(limit) : 10);
  }

  @Post('pay')
  sendPayment(@Body() dto: SendPaymentDto) {
    return this.stellar.sendPayment(dto);
  }
}
