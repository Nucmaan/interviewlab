'use client';

import Image from 'next/image';
import { useState } from 'react';
import { ActionForm, FieldError } from '@/components/action-form';
import { Field } from '@/components/field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { confirmTotpAction, disableTotpAction, startTotpAction } from '../actions/admin-actions';

/** Enable 2FA in two steps (scan QR, confirm a code), or disable it with the password. */
export function TotpSetup({ enabled }: { enabled: boolean }) {
  const [setup, setSetup] = useState<{ qrCode: string; secret: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (enabled) {
    return (
      <div className="flex flex-col gap-3">
        <Alert tone="success">Two-factor authentication is on.</Alert>
        <ActionForm
          action={disableTotpAction}
          submitLabel="Turn off 2FA"
          successMessage="2FA turned off."
        >
          <Field id="password" label="Confirm with your password">
            <Input id="password" name="password" type="password" autoComplete="current-password" />
            <FieldError name="password" />
          </Field>
        </ActionForm>
      </div>
    );
  }

  if (!setup) {
    return (
      <div className="flex flex-col gap-3">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <p className="text-sm text-muted-foreground">
          Protect your account with a code from an authenticator app (Google Authenticator,
          Microsoft Authenticator…).
        </p>
        <div>
          <Button
            onClick={async () => {
              const result = await startTotpAction({});
              if (result.ok) setSetup(result.data);
              else setError(result.error);
            }}
          >
            Set up 2FA
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">1. Scan this QR code with your authenticator app.</p>
      <Image src={setup.qrCode} alt="2FA QR code" width={180} height={180} unoptimized />
      <p className="text-xs text-muted-foreground">
        Or enter this key by hand: <span className="font-mono">{setup.secret}</span>
      </p>
      <p className="text-sm">2. Enter the 6-digit code the app shows.</p>
      <ActionForm
        action={confirmTotpAction}
        submitLabel="Turn on 2FA"
        successMessage="2FA is now on. You will need a code at every sign-in."
      >
        <Field id="code" label="Code">
          <Input
            id="code"
            name="code"
            inputMode="numeric"
            maxLength={6}
            autoComplete="one-time-code"
          />
          <FieldError name="code" />
        </Field>
      </ActionForm>
    </div>
  );
}
