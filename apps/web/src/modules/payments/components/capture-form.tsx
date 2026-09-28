'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { Field } from '@/components/field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import type { ActionResult } from '@/lib/action';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { PayerSearchResult } from '@/modules/registry/services/payer-search';
import { capturePaymentsAction } from '../actions/capture-actions';
import { captureSchema, CHANNELS, CURRENCIES, type CaptureInput } from '../schemas/payment';
import { CaptureConfirmation, type CaptureOutcome } from './capture-confirmation';

type RevenueOption = { code: string; name: string; category: 'TAX' | 'WATER' };

const STEPS = ['Payer & revenue type', 'Payment lines', 'Review & submit'] as const;

/**
 * A new, empty payment line. The amount starts empty (not 0) so the officer must type it; the
 * form type says number, hence the one cast. Zod reports "Enter an amount" if it stays empty.
 */
const emptyLine = (): CaptureInput['lines'][number] => ({
  amount: undefined as unknown as number,
  currency: 'SOS',
  channel: 'CASH',
  externalRef: '',
});

/**
 * Multi-step payment capture (Part 1 frontend question), built for tablets: large touch targets,
 * one column on small screens, numeric keyboards for amounts.
 *
 * Validation runs twice with the same Zod schema: here, for instant feedback, and in the server
 * action, which is the check that counts.
 */
export function CaptureForm({ revenueTypes }: { revenueTypes: RevenueOption[] }) {
  const [step, setStep] = useState(0);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PayerSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [payer, setPayer] = useState<PayerSearchResult | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<CaptureOutcome | null>(null);

  const form = useForm<CaptureInput>({
    resolver: zodResolver(captureSchema),
    // Validate when the officer presses Continue, then re-check while they type. (Validating on
    // blur made error messages vanish mid-tap on tablets, moving the button under the finger.)
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    defaultValues: {
      payerId: 0,
      revenueCode: '',
      assessmentId: null,
      billId: null,
      lines: [emptyLine()],
    },
  });
  const { register, control, setValue, trigger, handleSubmit, formState } = form;
  const lines = useFieldArray({ control, name: 'lines' });
  const revenueCode = useWatch({ control, name: 'revenueCode' });
  const assessmentId = useWatch({ control, name: 'assessmentId' });
  const billId = useWatch({ control, name: 'billId' });
  const selectedType = revenueTypes.find((t) => t.code === revenueCode);

  async function search() {
    setSearching(true);
    setServerError(null);
    try {
      const response = await fetch(`/api/payers/search?q=${encodeURIComponent(query)}`);
      if (!response.ok) throw new Error((await response.json()).error ?? 'Search failed');
      setResults((await response.json()).results as PayerSearchResult[]);
    } catch (error) {
      setServerError((error as Error).message);
    } finally {
      setSearching(false);
    }
  }

  function choosePayer(p: PayerSearchResult) {
    setPayer(p);
    setValue('payerId', p.payerId, { shouldValidate: true });
    setValue('assessmentId', null);
    setValue('billId', null);
  }

  async function next() {
    const fields = step === 0 ? (['payerId', 'revenueCode'] as const) : (['lines'] as const);
    if (await trigger(fields)) setStep((s) => s + 1);
  }

  async function onSubmit(values: CaptureInput) {
    setServerError(null);
    const result: ActionResult<CaptureOutcome> = await capturePaymentsAction(values);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    setOutcome(result.data);
  }

  if (outcome) {
    return (
      <CaptureConfirmation
        outcome={outcome}
        lines={form.getValues('lines')}
        revenueName={selectedType?.name ?? revenueCode}
        onNew={() => {
          form.reset();
          setOutcome(null);
          setPayer(null);
          setResults(null);
          setQuery('');
          setStep(0);
        }}
      />
    );
  }

  const outstanding =
    payer?.openAssessments.find((a) => a.assessmentId === assessmentId)?.outstanding ??
    payer?.openBills.find((b) => b.billId === billId)?.outstanding;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6" noValidate>
      <ol className="grid grid-cols-3 gap-2 text-sm" aria-label="Progress">
        {STEPS.map((label, index) => (
          <li
            key={label}
            aria-current={index === step ? 'step' : undefined}
            className={cn(
              'rounded-md border px-3 py-2',
              index === step && 'border-primary bg-primary/10 font-medium text-primary',
              index < step && 'bg-muted',
            )}
          >
            <span className="mr-1 font-semibold">{index + 1}.</span>
            {label}
          </li>
        ))}
      </ol>

      {serverError ? <Alert tone="danger">{serverError}</Alert> : null}

      {step === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Find the payer</CardTitle>
            <CardDescription>
              Search by TIN, phone number, water account number (WA-000123) or name.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                aria-label="Search payer"
                placeholder="e.g. 2001000012, 0615551234, WA-000001"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void search();
                  }
                }}
              />
              <Button onClick={() => void search()} disabled={searching || query.trim().length < 2}>
                {searching ? 'Searching…' : 'Search'}
              </Button>
            </div>

            {results && results.length === 0 ? (
              <Alert tone="warning">
                No payer found. Check the number or register the payer first.
              </Alert>
            ) : null}
            {results && results.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {results.map((r) => (
                  <li key={r.payerId}>
                    <button
                      type="button"
                      onClick={() => choosePayer(r)}
                      className={cn(
                        'w-full rounded-md border p-3 text-left hover:bg-muted',
                        payer?.payerId === r.payerId && 'border-primary ring-2 ring-primary/30',
                      )}
                    >
                      <div className="font-medium">{r.fullName}</div>
                      <div className="text-xs text-muted-foreground">
                        TIN {r.tin} · {r.phone ?? 'no phone'} · {r.openAssessments.length} open
                        assessments · {r.openBills.length} open water bills
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {formState.errors.payerId ? (
              <p className="text-sm text-destructive">{formState.errors.payerId.message}</p>
            ) : null}

            {payer ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  id="revenueCode"
                  label="Revenue type"
                  error={formState.errors.revenueCode?.message}
                >
                  <Select
                    id="revenueCode"
                    {...register('revenueCode', {
                      onChange: () => {
                        setValue('assessmentId', null);
                        setValue('billId', null);
                      },
                    })}
                  >
                    <option value="">Select…</option>
                    {revenueTypes.map((t) => (
                      <option key={t.code} value={t.code}>
                        {t.name} ({t.code})
                      </option>
                    ))}
                  </Select>
                </Field>
                {selectedType?.category === 'WATER' ? (
                  <Field
                    id="billId"
                    label="Water bill (optional)"
                    hint="The latest bill includes any arrears."
                  >
                    <Select
                      id="billId"
                      value={billId ?? ''}
                      onChange={(e) =>
                        setValue('billId', e.target.value ? Number(e.target.value) : null)
                      }
                    >
                      <option value="">No specific bill</option>
                      {payer.openBills.map((b) => (
                        <option key={b.billId} value={b.billId}>
                          {b.accountNo} · {b.billingMonth} · {b.controlNumber} · owes{' '}
                          {formatMoney(b.outstanding)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : selectedType ? (
                  <Field id="assessmentId" label="Assessment (optional)">
                    <Select
                      id="assessmentId"
                      value={assessmentId ?? ''}
                      onChange={(e) =>
                        setValue('assessmentId', e.target.value ? Number(e.target.value) : null)
                      }
                    >
                      <option value="">No specific assessment</option>
                      {payer.openAssessments
                        .filter((a) => a.revenueCode === revenueCode)
                        .map((a) => (
                          <option key={a.assessmentId} value={a.assessmentId}>
                            {a.controlNumber} · {a.period ?? ''} · due {a.dueDate} · owes{' '}
                            {formatMoney(a.outstanding)}
                          </option>
                        ))}
                    </Select>
                  </Field>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {step === 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>Payment lines</CardTitle>
            <CardDescription>
              {payer?.fullName} · {selectedType?.name}
              {outstanding !== undefined ? ` · outstanding ${formatMoney(outstanding)}` : ''}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {lines.fields.map((field, index) => {
              const errors = formState.errors.lines?.[index];
              return (
                <fieldset
                  key={field.id}
                  className="grid gap-3 rounded-md border p-3 md:grid-cols-2 xl:grid-cols-[1fr_7rem_10rem_1.5fr_auto]"
                >
                  <legend className="px-1 text-xs font-semibold text-muted-foreground">
                    Line {index + 1}
                  </legend>
                  <Field id={`amount-${index}`} label="Amount" error={errors?.amount?.message}>
                    <Input
                      id={`amount-${index}`}
                      inputMode="decimal"
                      aria-invalid={Boolean(errors?.amount)}
                      {...register(`lines.${index}.amount`, {
                        setValueAs: (v: string) => (v === '' ? undefined : Number(v)),
                      })}
                    />
                  </Field>
                  <Field id={`currency-${index}`} label="Currency">
                    <Select id={`currency-${index}`} {...register(`lines.${index}.currency`)}>
                      {CURRENCIES.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field id={`channel-${index}`} label="Channel">
                    <Select id={`channel-${index}`} {...register(`lines.${index}.channel`)}>
                      {CHANNELS.map((c) => (
                        <option key={c} value={c}>
                          {c.replace('_', ' ')}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field
                    id={`ref-${index}`}
                    label="External reference"
                    error={errors?.externalRef?.message}
                  >
                    <div className="flex gap-2">
                      <Input
                        id={`ref-${index}`}
                        aria-invalid={Boolean(errors?.externalRef)}
                        {...register(`lines.${index}.externalRef`)}
                      />
                      <Button
                        variant="outline"
                        title="Generate a cash receipt number"
                        onClick={() =>
                          setValue(
                            `lines.${index}.externalRef`,
                            `CSH-${Date.now().toString(36).toUpperCase()}-${index + 1}`,
                            {
                              shouldValidate: true,
                            },
                          )
                        }
                      >
                        Gen
                      </Button>
                    </div>
                  </Field>
                  <div className="flex items-end">
                    <Button
                      variant="ghost"
                      onClick={() => lines.remove(index)}
                      disabled={lines.fields.length === 1}
                      aria-label={`Remove line ${index + 1}`}
                    >
                      Remove
                    </Button>
                  </div>
                </fieldset>
              );
            })}
            {formState.errors.lines?.root?.message || formState.errors.lines?.message ? (
              <p className="text-sm text-destructive">
                {formState.errors.lines?.root?.message ?? formState.errors.lines?.message}
              </p>
            ) : null}
            <Button
              variant="outline"
              onClick={() => lines.append(emptyLine())}
              disabled={lines.fields.length >= 10}
            >
              Add another line
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {step === 2 ? (
        <Card>
          <CardHeader>
            <CardTitle>Review</CardTitle>
            <CardDescription>Check the details with the payer before submitting.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <div>
              <span className="text-muted-foreground">Payer:</span> {payer?.fullName} (TIN{' '}
              {payer?.tin})
            </div>
            <div>
              <span className="text-muted-foreground">Revenue type:</span> {selectedType?.name}
            </div>
            <ul className="mt-2 divide-y rounded-md border">
              {form.getValues('lines').map((line, i) => (
                <li key={i} className="flex flex-wrap justify-between gap-2 p-2">
                  <span>
                    {line.channel.replace('_', ' ')} · {line.externalRef}
                  </span>
                  <span className="font-medium">{formatMoney(line.amount, line.currency)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex justify-between gap-2">
        <Button
          variant="outline"
          size="lg"
          onClick={() => setStep((s) => s - 1)}
          disabled={step === 0 || formState.isSubmitting}
        >
          Back
        </Button>
        {/* Different keys: React must not turn the Continue button into the submit button in
            place, or the click that opens step 3 would also submit the form. */}
        {step < 2 ? (
          <Button key="continue" size="lg" onClick={() => void next()}>
            Continue
          </Button>
        ) : (
          <Button key="submit" size="lg" type="submit" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? 'Submitting…' : 'Submit payment'}
          </Button>
        )}
      </div>
    </form>
  );
}
