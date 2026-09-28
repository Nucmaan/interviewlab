'use client';

import { useActionState } from 'react';
import { Field } from '@/components/field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { loginAction, type LoginState } from '../actions/session-actions';

export function LoginForm() {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(loginAction, {});

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error ? <Alert tone={state.needsTotp ? 'info' : 'danger'}>{state.error}</Alert> : null}
      <Field id="email" label="Email">
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          defaultValue={state.email}
        />
      </Field>
      <Field id="password" label="Password">
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>
      <Field
        id="totp"
        label="2FA code"
        hint="Only if you have turned on two-factor authentication."
      >
        <Input
          id="totp"
          name="totp"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          placeholder="123456"
          autoFocus={state.needsTotp}
        />
      </Field>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
