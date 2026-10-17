import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SendController } from './send.controller';
import { SendService } from './send.service';
import { StellarModule } from '../stellar/stellar.module';
import { UsersModule } from '../users/user.module';
import { AuthModule } from '../auth/auth.module';
import { SetupCompleteGuard } from '../auth/setup-complete.guard';

@Module({
  imports: [ConfigModule, StellarModule, UsersModule, AuthModule],
  controllers: [SendController],
  providers: [SendService, SetupCompleteGuard],
})
export class SendModule {}
