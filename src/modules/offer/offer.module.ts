import { Module } from '@nestjs/common';
import { OfferController } from './offer.controller';
import { OfferRepository } from './offer.repository';
import { OfferService } from './offer.service';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { SetupCompleteGuard } from '../auth/setup-complete.guard';
@Module({
  imports: [AuditLogModule],
  controllers: [OfferController],
  providers: [OfferService, OfferRepository, SetupCompleteGuard],
})
export class OfferModule {}
