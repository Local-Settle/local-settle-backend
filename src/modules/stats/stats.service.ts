import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { StatsQueryDto } from './dto/stats-query.dto';

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats(query: StatsQueryDto) {
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
      this.prisma.appUser.count({ where: { deletedAt: null } }),
      this.prisma.escrowOnChain.count(),
      this.prisma.escrowOnChain.count({ where: { escrowStatus: 'released' } }),
      this.prisma.order.count({ where: { orderStatus: 'released' } }),
      this.prisma.appUser.findFirst({
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      this.prisma.$queryRaw<{ date: string; count: bigint }[]>`
        SELECT DATE(created_at)::text AS date, COUNT(*)::int AS count
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

    const window = query.window || '7d';
    const now = new Date();
    now.setHours(23, 59, 59, 999);

    // Build full cumulative timeline from earliest data to today
    let fullStartDate: Date;
    if (dailyCounts.length > 0) {
      fullStartDate = new Date(dailyCounts[0].date + 'T00:00:00');
    } else {
      fullStartDate = new Date(now);
    }
    fullStartDate.setHours(0, 0, 0, 0);

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
        runningTotal += Number(dailyCounts[dataIdx].count);
        dataIdx++;
      }

      fullTimeline.push({ date: dateStr, count: runningTotal });
      cursor.setDate(cursor.getDate() + 1);
    }

    // Determine window start for filtering
    let windowStart: Date;

    switch (window) {
      case '2s':
        windowStart = new Date(now);
        windowStart.setDate(windowStart.getDate() - 13);
        break;
      case '1m':
        windowStart = new Date(now);
        windowStart.setMonth(windowStart.getMonth() - 1);
        break;
      case 'all':
        windowStart = new Date(fullStartDate);
        break;
      case '7d':
      default:
        windowStart = new Date(now);
        windowStart.setDate(windowStart.getDate() - 6);
        break;
    }
    windowStart.setHours(0, 0, 0, 0);

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
      (end.getFullYear() - start.getFullYear()) * 12 +
      (end.getMonth() - start.getMonth())
    );
  }

  private formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}
