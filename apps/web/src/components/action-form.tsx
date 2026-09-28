'use client';

import { useRouter } from 'next/navigation';
import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { ActionResult } from '@/lib/action';

type FieldErrors = Record<string, string[] | undefined>;
const ErrorsContext = createContext<FieldErrors>({});

/**
 * Turns form fields into a plain object for a server action.
 * Fields named "x[]" (checkbox groups) always become arrays; empty inputs become undefined so
 * optional Zod fields work. Numbers and booleans are converted by the Zod schema (z.coerce).
 */
export function formDataToObject(formData: FormData): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [rawKey, value] of formData.entries()) {
    if (typeof value !== 'string') continue;
    if (rawKey.endsWith('[]')) {
      const key = rawKey.slice(0, -2);
      result[key] = [...((result[key] as string[] | undefined) ?? []), value];
    } else {
      result[rawKey] = value === '' ? undefined : value;
    }
  }
  return result;
}

/**
 * A form that calls a server action built with createAction(). Shows the error or success
 * message, per-field errors (via <FieldError name="..."/>), and refreshes the page on success.
 */
export function ActionForm<T>({
  action,
  children,
  submitLabel = 'Save',
  successMessage,
  resetOnSuccess = false,
  extra,
  className,
  onSuccess,
}: {
  action: (input: never) => Promise<ActionResult<T>>;
  children: ReactNode;
  submitLabel?: string;
  /**
   * Shown after success. "{field}" placeholders are filled from the action's result, e.g.
   * "Created {controlNumber}". (A string, because server components cannot pass functions to
   * client components.)
   */
  successMessage?: string;
  resetOnSuccess?: boolean;
  /** Fixed values sent with the form (e.g. the id being edited). */
  extra?: Record<string, unknown>;
  className?: string;
  onSuccess?: (data: T) => void;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    const input = { ...formDataToObject(new FormData(event.currentTarget)), ...extra };
    const result = await (action as (i: unknown) => Promise<ActionResult<T>>)(input);
    setPending(false);
    if (!result.ok) {
      setFieldErrors(result.fieldErrors ?? {});
      setMessage({ tone: 'danger', text: result.error });
      return;
    }
    setFieldErrors({});
    if (successMessage)
      setMessage({ tone: 'success', text: fillTemplate(successMessage, result.data) });
    if (resetOnSuccess) formRef.current?.reset();
    onSuccess?.(result.data);
    router.refresh();
  }

  return (
    <ErrorsContext.Provider value={fieldErrors}>
      <form
        ref={formRef}
        onSubmit={onSubmit}
        className={className ?? 'flex flex-col gap-4'}
        noValidate
      >
        {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
        {children}
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : submitLabel}
          </Button>
        </div>
      </form>
    </ErrorsContext.Provider>
  );
}

function fillTemplate(template: string, data: unknown): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value =
      data && typeof data === 'object' ? (data as Record<string, unknown>)[key] : undefined;
    return value === undefined || value === null ? match : String(value);
  });
}

export function FieldError({ name }: { name: string }) {
  const errors = useContext(ErrorsContext)[name];
  return errors?.[0] ? <p className="text-xs font-medium text-destructive">{errors[0]}</p> : null;
}

/** A single button that runs an action (approve, deactivate, retry ...). */
export function ActionButton<T>({
  action,
  input,
  label,
  variant = 'outline',
  confirmText,
}: {
  action: (input: never) => Promise<ActionResult<T>>;
  input: Record<string, unknown>;
  label: string;
  variant?: 'default' | 'outline' | 'destructive' | 'secondary';
  /** Shown inline as a second click ("Click again to confirm"), not a browser dialog. */
  confirmText?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (confirmText && !armed) {
      setArmed(true);
      return;
    }
    setPending(true);
    setError(null);
    const result = await (action as (i: unknown) => Promise<ActionResult<T>>)(input);
    setPending(false);
    setArmed(false);
    if (!result.ok) setError(result.error);
    else router.refresh();
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <Button size="sm" variant={variant} onClick={() => void run()} disabled={pending}>
        {pending ? 'Working…' : armed ? (confirmText ?? label) : label}
      </Button>
      {error ? <span className="max-w-xs text-xs text-destructive">{error}</span> : null}
    </span>
  );
}
