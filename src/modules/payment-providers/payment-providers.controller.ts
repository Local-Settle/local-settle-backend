import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { validatePaymentProviderMetadata } from './payment-provider-metadata.validator';

@Controller('payment-providers')
export class PaymentProvidersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async findAll() {
    const providers = await this.prisma.payment_provider.findMany({
      where: { is_active: true },
      orderBy: { name: 'asc' },
    });
    return providers.map((provider) => ({
      ...provider,
      metadataSchemaVersion: validatePaymentProviderMetadata(
        provider.type,
        provider.metadata,
      ),
    }));
  }
}
