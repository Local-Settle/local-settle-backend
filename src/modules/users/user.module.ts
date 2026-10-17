import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';
import { AuthModule } from '../auth/auth.module';
import { FileStorageModule } from '../file-storage/file-storage.module';
import { PaymentMethodsModule } from '../payment-methods/payment-methods.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { SetupCompleteGuard } from '../auth/setup-complete.guard';

@Module({
  imports: [
    AuthModule,
    FileStorageModule,
    PaymentMethodsModule,
    AuditLogModule,
  ],
  controllers: [UsersController],
  providers: [UsersService, UsersRepository, SetupCompleteGuard],
  exports: [UsersService, UsersRepository],
})
export class UsersModule {}
