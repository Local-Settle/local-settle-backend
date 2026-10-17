import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { StatsQueryDto } from './dto/stats-query.dto';

@Injectable()
export class StatsService {
  private readonly cache = new Map<
    string,
    { expiresAt: number; value: Awaited<ReturnType<StatsService['buildStats']>> }
  >();
  private static readonly CACHE_TTL_MS = 30_000;
  private static readonly MAX_CACHE_ENTRIES = 20;
  private static readonly MIN_PUBLIC_COHORT = 5;

  constructor(private readonly prisma: PrismaService) {}

  async getStats(query: StatsQueryDto) {
    const window = query.window || '7d';
    const cached = this.cache.get(window);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    if (cached) this.cache.delete(window);

    const value = await this.buildStats(query);
    if (this.cache.size >= StatsService.MAX_CACHE_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) this.cache.delete(oldestKey);
    }
    this.cache.set(window, {
      expiresAt: Date.now() + StatsService.CACHE_TTL_MS,
      value,
    });
    return value;
  }

  /** Call after a write that changes the public statistics aggregates. */
  invalidateCache(): void {
    this.cache.clear();
  }

  private async buildStats(query: StatsQueryDto) {
    const [
      waitlistMember,
      walletsConnected,
      escrowCreated,
      escrowsCompleted,
      ordersReleased,
      oldestUser,
      dailyCounts,
    ] = await Promise.all([
      this.prisma.waitlist.count(),
      this.prisma.appUser.count(),
      this.prisma.escrowOnChain.count(),
      this.prisma.escrowOnChain.count({ where: { escrowStatus: 'released' } }),
      this.prisma.order.count({ where: { orderStatus: 'released' } }),
      this.prisma.appUser.findFirst({
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      this.prisma.$queryRaw<{ date: string; count: bigint }[]>`
        SELECT DATE(created_at AT TIME ZONE 'UTC')::text AS date, COUNT(*)::int AS count
        FROM waitlist
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `,
    ]);

    const monthsSinceStart = oldestUser
      ? Math.max(1, this.monthsBetween(oldestUser.createdAt, new Date()))
      : 1;

    const avgMonthlyCompletedEscrow = +(
      escrowsCompleted / monthsSinceStart
    ).toFixed(2);
    const avgTransactionsPerUser = +(
      ordersReleased /
      walletsConnected /
      monthsSinceStart
    ).toFixed(2);

    const now = new Date();
    now.setUTCHours(23, 59, 59, 999);

    // Build full cumulative timeline from earliest data to today
    let fullStartDate: Date;
    if (dailyCounts.length > 0) {
      fullStartDate = new Date(`${dailyCounts[0].date}T00:00:00.000Z`);
    } else {
      fullStartDate = new Date(now);
    }
    fullStartDate.setUTCHours(0, 0, 0, 0);

    const fullTimeline: { date: string; count: number }[] = [];
    const cursor = new Date(fullStartDate);
    let runningTotal = 0;
    let dataIdx = 0;

    while (cursor <= now) {
      const dateStr = this.formatDate(cursor);

      if (
        dataIdx < dailyCounts.length &&
        dailyCounts[dataIdx].date === dateStr
      ) {
        const count = Number(dailyCounts[dataIdx].count);
        // Suppress small daily groups to reduce re-identification risk.
        if (count >= StatsService.MIN_PUBLIC_COHORT) runningTotal += count;
        dataIdx++;
      }

      fullTimeline.push({ date: dateStr, count: runningTotal });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    // Determine window start for filtering
    let windowStart: Date;

    switch (window) {
      case '2s':
        windowStart = new Date(now);
        windowStart.setUTCDate(windowStart.getUTCDate() - 13);
        break;
      case '1m':
        windowStart = new Date(now);
        windowStart.setUTCMonth(windowStart.getUTCMonth() - 1);
        break;
      case 'all':
        windowStart = new Date(fullStartDate);
        break;
      case '7d':
      default:
        windowStart = new Date(now);
        windowStart.setUTCDate(windowStart.getUTCDate() - 6);
        break;
    }
    windowStart.setUTCHours(0, 0, 0, 0);

    const windowStartStr = this.formatDate(windowStart);
    const waitlistTimeline = fullTimeline.filter(
      (item) => item.date >= windowStartStr,
    );

    return {
      waitlist_member: waitlistMember,
      wallets_connected: walletsConnected,
      escrows_completed: escrowsCompleted,
      escrow_created: escrowCreated,
      avg_monthly_completed_escrow: avgMonthlyCompletedEscrow,
      avg_transactions_per_user: avgTransactionsPerUser,
      waitlist_timeline: waitlistTimeline,
    };
  }

  private monthsBetween(start: Date, end: Date): number {
    return (
      (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
      (end.getUTCMonth() - start.getUTCMonth())
    );
  }

  private formatDate(date: Date): string {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}
