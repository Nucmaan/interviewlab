'use client';

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCompact } from '@/lib/format';

const COLORS = ['#0b5d8a', '#e07a1f', '#2a9d8f', '#8e44ad', '#c0392b', '#7f8c8d', '#d4a017'];
const money = (v: unknown) => formatCompact(Number(v));
const axisProps = { tick: { fontSize: 11 }, stroke: '#94a3b8' } as const;

function ChartFrame({ children, height = 280 }: { children: React.ReactElement; height?: number }) {
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>{children}</ResponsiveContainer>
    </div>
  );
}

/** Revenue trend over time, one line per revenue type (or channel). */
export function TrendChart({
  rows,
  keys,
  labels = {},
}: {
  rows: Record<string, string | number>[];
  keys: string[];
  labels?: Record<string, string>;
}) {
  return (
    <ChartFrame>
      <LineChart data={rows} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="month" {...axisProps} />
        <YAxis tickFormatter={money} width={80} {...axisProps} />
        <Tooltip formatter={money} />
        <Legend />
        {keys.map((key, i) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            name={labels[key] ?? key}
            stroke={COLORS[i % COLORS.length]}
            dot={false}
            strokeWidth={2}
          />
        ))}
      </LineChart>
    </ChartFrame>
  );
}

/** Collected (bars) against the monthly target (line). */
export function TargetChart({
  rows,
}: {
  rows: { month: string; collected: number; target: number }[];
}) {
  return (
    <ChartFrame>
      <ComposedChart data={rows} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="month" {...axisProps} />
        <YAxis tickFormatter={money} width={80} {...axisProps} />
        <Tooltip formatter={money} />
        <Legend />
        <Bar dataKey="collected" name="Collected" fill="#0b5d8a" radius={[3, 3, 0, 0]} />
        <Line dataKey="target" name="Target" stroke="#e07a1f" strokeWidth={2} dot={false} />
      </ComposedChart>
    </ChartFrame>
  );
}

/** Water billed vs collected (bars) with collection efficiency % (line, right axis). */
export function WaterEfficiencyChart({
  rows,
}: {
  rows: { month: string; billed: number; collected: number; efficiencyPct: number }[];
}) {
  return (
    <ChartFrame>
      <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="month" {...axisProps} />
        <YAxis yAxisId="money" tickFormatter={money} width={80} {...axisProps} />
        <YAxis yAxisId="pct" orientation="right" unit="%" width={48} {...axisProps} />
        <Tooltip formatter={(v, name) => (name === 'Efficiency' ? `${String(v)}%` : money(v))} />
        <Legend />
        <Bar yAxisId="money" dataKey="billed" name="Billed" fill="#94a3b8" radius={[3, 3, 0, 0]} />
        <Bar
          yAxisId="money"
          dataKey="collected"
          name="Collected"
          fill="#2a9d8f"
          radius={[3, 3, 0, 0]}
        />
        <Line
          yAxisId="pct"
          dataKey="efficiencyPct"
          name="Efficiency"
          stroke="#c0392b"
          strokeWidth={2}
          dot
        />
      </ComposedChart>
    </ChartFrame>
  );
}

/**
 * Monthly actuals, the regression (trend) line, and the next 3 months forecast by both models:
 * plain linear regression (grey, dashed) and trend x seasonal factor (orange, dashed).
 */
export function ForecastChart({
  history,
  forecastMonths,
  slope,
  intercept,
  linear,
  seasonal,
}: {
  history: { month: string; actual: number }[];
  forecastMonths: string[];
  slope: number;
  intercept: number;
  linear: number[];
  seasonal: number[];
}) {
  const rows = [
    ...history.map((h, x) => ({
      month: h.month,
      actual: h.actual,
      trend: Math.round(intercept + slope * x),
    })),
    ...forecastMonths.map((month, i) => ({
      month,
      trend: Math.round(intercept + slope * (history.length + i)),
      linear: linear[i],
      seasonal: seasonal[i],
    })),
  ];
  return (
    <ChartFrame>
      <LineChart data={rows} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="month" {...axisProps} />
        <YAxis tickFormatter={money} width={80} {...axisProps} />
        <Tooltip formatter={money} />
        <Legend />
        <Line dataKey="actual" name="Actual" stroke="#0b5d8a" strokeWidth={2} dot={false} />
        <Line dataKey="trend" name="Regression line" stroke="#cbd5e1" strokeWidth={1} dot={false} />
        <Line
          dataKey="linear"
          name="Linear forecast"
          stroke="#64748b"
          strokeWidth={2}
          strokeDasharray="4 4"
        />
        <Line
          dataKey="seasonal"
          name="Seasonal forecast"
          stroke="#e07a1f"
          strokeWidth={3}
          strokeDasharray="6 4"
        />
      </LineChart>
    </ChartFrame>
  );
}
