'use client';

import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { verifyChainAction } from '../actions/audit-actions';

type Result = Awaited<ReturnType<typeof verifyChainAction>>;

export function VerifyChainButton() {
  const [result, setResult] = useState<Result | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        onClick={async () => {
          setPending(true);
          setResult(await verifyChainAction({}));
          setPending(false);
        }}
        disabled={pending}
      >
        {pending ? 'Verifying…' : 'Verify chain'}
      </Button>
      {result && !result.ok ? <Alert tone="danger">{result.error}</Alert> : null}
      {result?.ok && result.data.valid ? (
        <Alert tone="success">
          Chain intact: all {result.data.checked.toLocaleString('en-US')} rows verified in{' '}
          {result.data.durationMs} ms.
        </Alert>
      ) : null}
      {result?.ok && !result.data.valid ? (
        <Alert tone="danger">
          TAMPERING DETECTED at audit row #{result.data.brokenAtId}: {result.data.reason}.
        </Alert>
      ) : null}
    </div>
  );
}
