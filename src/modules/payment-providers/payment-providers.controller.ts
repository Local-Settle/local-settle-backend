import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

const PROVIDER_TYPES = ['MOBILE', 'PLATFORM', 'BANK'] as const;

function normalizeCountryCode(input: string): string {
  const country = input.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) {
    throw new BadRequestException('country must be a two-letter ISO 3166-1 code');
  }
  const name = new Intl.DisplayNames(['en'], { type: 'region' }).of(country);
  if (!name || name === country) {
    throw new BadRequestException('Unsupported ISO country code');
  }
  return country;
}

@Controller('payment-providers')
export class PaymentProvidersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async findAll(
    @Query('country') country?: string,
    @Query('type') type?: string,
  ) {
    if (type && !PROVIDER_TYPES.includes(type.trim().toUpperCase() as (typeof PROVIDER_TYPES)[number])) {
      throw new BadRequestException('Unsupported payment-provider type');
    }
    return this.prisma.payment_provider.findMany({
      where: {
        is_active: true,
        ...(country ? { country_code: { equals: normalizeCountryCode(country), mode: 'insensitive' } } : {}),
        ...(type ? { type: type.trim().toUpperCase() as (typeof PROVIDER_TYPES)[number] } : {}),
      },
      orderBy: { name: 'asc' },
    });
  }
}
