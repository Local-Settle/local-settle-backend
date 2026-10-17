import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { EscrowModule } from '../escrow/escrow.module';
import { OrderModule } from '../order/order.module';
import { StellarService } from './stellar.service';
import { StellarEventParserService } from './stellar-event-parser.service';
import { StellarListenerService } from './stellar-listener.service';
import { StellarController } from './stellar.controller';
import { SetupCompleteGuard } from '../auth/setup-complete.guard';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    AuditLogModule,
    EscrowModule,
    OrderModule,
  ],
  providers: [
    StellarService,
    StellarEventParserService,
    StellarListenerService,
    SetupCompleteGuard,
  ],
  controllers: [StellarController],
  exports: [StellarService, StellarEventParserService, StellarListenerService],
})
export class StellarModule {}
