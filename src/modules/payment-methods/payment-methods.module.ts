import { Module } from '@nestjs/common';
import { PaymentMethodsController } from './payment-methods.controller';
import { PaymentMethodsRepository } from './payment-methods.repository';
import { PaymentMethodsService } from './payment-methods.service';
import { PaymentMethodValidatorService } from './payment-method-validator.service';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { SetupCompleteGuard } from '../auth/setup-complete.guard';
@Module({
  imports: [AuditLogModule],
  controllers: [PaymentMethodsController],
  providers: [
    PaymentMethodsService,
    PaymentMethodsRepository,
    PaymentMethodValidatorService,
    SetupCompleteGuard,
  ],
  exports: [PaymentMethodValidatorService],
})
export class PaymentMethodsModule {}
