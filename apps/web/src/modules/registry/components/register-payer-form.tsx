'use client';

import { useRouter } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { createPayerAction } from '../actions/payer-actions';
import { PayerFields } from './payer-fields';

export function RegisterPayerForm() {
  const router = useRouter();
  return (
    <ActionForm
      action={createPayerAction}
      submitLabel="Register payer"
      onSuccess={(data) =>
        router.push(`/payers/${data.payerId}${data.duplicates > 0 ? '?duplicates=1' : ''}`)
      }
    >
      <PayerFields />
    </ActionForm>
  );
}
