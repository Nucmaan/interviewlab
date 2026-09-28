import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <span className="text-xs font-medium uppercase text-muted-foreground">{label}</span>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">{value}</div>
        {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
      </CardContent>
    </Card>
  );
}
