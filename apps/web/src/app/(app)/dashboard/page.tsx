import Link from 'next/link';
import { ActionButton } from '@/components/action-form';
import { PageHeader } from '@/components/page-header';
import { RefreshOnEvent } from '@/components/refresh-on-event';
import { StatCard } from '@/components/stat-card';
import { StatusBadge } from '@/components/status-badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { prisma } from '@/lib/db';
import { formatCompact, formatDateTime, formatMoney, formatNumber } from '@/lib/format';
import { hasPermission, requirePermission } from '@/lib/rbac';
import { simulateTrafficAction } from '@/modules/dashboard/actions/dashboard-actions';
import {
  ForecastChart,
  TargetChart,
  TrendChart,
  WaterEfficiencyChart,
} from '@/modules/dashboard/components/charts';
import {
  collectionsVsTargets,
  monthlyByChannel,
  monthlyByRevenueType,
  quarterlyCollections,
  recentAlerts,
  revenueForecast,
  topArrears,
  waterEfficiency,
} from '@/modules/dashboard/services/reports';
import { getRevenueSummaryForDay } from '@/modules/dashboard/services/revenue-summary';

export const metadata = { title: 'Executive dashboard' };

export default async function DashboardPage() {
  const user = await requirePermission('dashboard.view');
  const today = new Date().toISOString().slice(0, 10);
  const [
    byType,
    byChannel,
    targets,
    water,
    quarterly,
    arrears,
    forecast,
    alerts,
    todaySummary,
    revenueTypes,
  ] = await Promise.all([
    monthlyByRevenueType(24),
    monthlyByChannel(24),
    collectionsVsTargets(12),
    waterEfficiency(12),
    quarterlyCollections(),
    topArrears(),
    revenueForecast(),
    recentAlerts(),
    getRevenueSummaryForDay(today),
    prisma.revenueType.findMany({ select: { revenue_code: true, name: true } }),
  ]);
  const typeLabels = Object.fromEntries(revenueTypes.map((t) => [t.revenue_code, t.name]));
  const thisMonth = targets[targets.length - 1];
  const lastWater = water.monthly[water.monthly.length - 1];
  const quarters = [1, 2, 3, 4].map((q) => quarterly.rows.filter((r) => r.quarter === q));

  return (
    <div className="flex flex-col gap-6">
      {/* Live: re-render when the worker refreshes the summary or raises an alert. */}
      <RefreshOnEvent types={['summary.updated', 'alert.created']} minIntervalMs={5000} />
      <PageHeader
        title="Executive dashboard"
        description="Pre-aggregated data (daily_summary), refreshed by the worker and pushed live with Server-Sent Events."
        actions={
          hasPermission(user, 'alerts.manage') ? (
            <ActionButton
              action={simulateTrafficAction}
              input={{ count: 20 }}
              label="Demo: simulate 20 mobile money payments"
            />
          ) : null
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Collected today"
          value={formatMoney(todaySummary.totalBase)}
          hint={`${formatNumber(todaySummary.revenueTypes.reduce((s, r) => s + r.paymentCount, 0))} payments · cache ${todaySummary.cache.hits}/${todaySummary.cache.hits + todaySummary.cache.misses} hits`}
        />
        <StatCard
          label="This month vs target"
          value={thisMonth?.achievedPct !== null && thisMonth ? `${thisMonth.achievedPct}%` : '—'}
          hint={
            thisMonth
              ? `${formatCompact(thisMonth.collected)} of ${formatCompact(thisMonth.target)}`
              : undefined
          }
        />
        <StatCard
          label={`Water efficiency ${water.latestMonth}`}
          value={lastWater ? `${lastWater.efficiencyPct}%` : '—'}
          hint={
            lastWater
              ? `${formatCompact(lastWater.collected)} collected of ${formatCompact(lastWater.billed)} billed`
              : undefined
          }
        />
        <StatCard
          label="Forecast next 3 months"
          value={formatCompact(forecast.seasonal.nextQuarterTotal)}
          hint={`Trend × seasonality · fit R² ${forecast.seasonal.fittedRSquared.toFixed(2)}`}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Revenue by type (monthly)</CardTitle>
          </CardHeader>
          <CardContent>
            <TrendChart rows={byType.rows} keys={byType.keys} labels={typeLabels} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Revenue by channel (monthly)</CardTitle>
          </CardHeader>
          <CardContent>
            <TrendChart
              rows={byChannel.rows}
              keys={byChannel.keys}
              labels={{ BANK: 'Bank', MOBILE_MONEY: 'Mobile money', CASH: 'Cash' }}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Collections vs targets</CardTitle>
          </CardHeader>
          <CardContent>
            <TargetChart rows={targets} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Water: billed vs collected</CardTitle>
            <CardDescription>
              Collection efficiency = collected ÷ billed. Above 100% means customers paid off old
              arrears.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <WaterEfficiencyChart rows={water.monthly} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            Forecast for the next 3 months: {formatMoney(forecast.seasonal.nextQuarterTotal)}
          </CardTitle>
          <CardDescription>
            <strong>Linear regression</strong> over the last 24 complete months gives a trend of +
            {formatCompact(forecast.linear.model.slope)} per month and{' '}
            {formatMoney(forecast.linear.nextQuarterTotal)} for the next 3 months, but its R² is
            only {forecast.linear.model.rSquared.toFixed(2)}: collections are highly seasonal
            (business licences are all due in January), which a straight line cannot capture. The{' '}
            <strong>seasonal forecast</strong> (recommended) keeps the same regression trend and
            multiplies it by each calendar month&apos;s usual level (fit R²{' '}
            {forecast.seasonal.fittedRSquared.toFixed(2)}). Neither model knows about one-off events
            or policy changes, so treat the figure as a planning estimate.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ForecastChart
            history={forecast.history}
            forecastMonths={forecast.forecastMonths}
            slope={forecast.linear.model.slope}
            intercept={forecast.linear.model.intercept}
            linear={forecast.linear.monthly}
            seasonal={forecast.seasonal.monthly}
          />
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>FY{quarterly.financialYear} by quarter (running total and share)</CardTitle>
          </CardHeader>
          <Table>
            <THead>
              <Tr>
                <Th>Revenue type</Th>
                {[1, 2, 3, 4].map((q) => (
                  <Th key={q} className="text-right">
                    Q{q}
                  </Th>
                ))}
              </Tr>
            </THead>
            <TBody>
              {(quarters[0] ?? []).map((row) => (
                <Tr key={row.revenueCode}>
                  <Td>{row.name}</Td>
                  {quarters.map((q, i) => {
                    const cell = q.find((r) => r.revenueCode === row.revenueCode);
                    return (
                      <Td key={i} className="text-right text-xs">
                        {cell ? (
                          <>
                            <div className="font-medium">{formatCompact(cell.total)}</div>
                            <div className="text-muted-foreground">
                              Σ {formatCompact(cell.runningTotal)} · {cell.sharePct ?? 0}%
                            </div>
                          </>
                        ) : (
                          '—'
                        )}
                      </Td>
                    );
                  })}
                </Tr>
              ))}
            </TBody>
          </Table>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top 10 water arrears older than 90 days</CardTitle>
          </CardHeader>
          <Table>
            <THead>
              <Tr>
                <Th>Account</Th>
                <Th>Customer</Th>
                <Th className="text-right">Over 90 days</Th>
                <Th className="text-right">Total owed</Th>
              </Tr>
            </THead>
            <TBody>
              {arrears.map((a) => (
                <Tr key={a.accountNo}>
                  <Td className="whitespace-nowrap">
                    <Link
                      className="text-primary hover:underline"
                      href={`/water/accounts/${a.accountNo}`}
                    >
                      {a.accountNo}
                    </Link>
                  </Td>
                  <Td>{a.name}</Td>
                  <Td className="text-right">{formatMoney(a.arrears90)}</Td>
                  <Td className="text-right">{formatMoney(a.outstanding)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Latest alerts</CardTitle>
          <CardDescription>
            Sudden drop against the 7-day average, reversal spikes, failed payments and failed FMIS
            postings.
          </CardDescription>
        </CardHeader>
        <Table>
          <TBody>
            {alerts.length === 0 ? (
              <Tr>
                <Td className="text-muted-foreground">No alerts.</Td>
              </Tr>
            ) : null}
            {alerts.map((a) => (
              <Tr key={a.alert_id}>
                <Td className="whitespace-nowrap">{formatDateTime(a.created_at)}</Td>
                <Td>
                  <StatusBadge status={a.severity} />
                </Td>
                <Td>{a.message}</Td>
                <Td>{a.acknowledged_at ? 'Acknowledged' : ''}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
