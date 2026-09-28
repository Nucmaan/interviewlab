import { FieldError } from '@/components/action-form';
import { Field } from '@/components/field';
import { Input, Select } from '@/components/ui/input';

interface PayerDefaults {
  payer_type?: string;
  full_name?: string;
  tin?: string;
  national_id?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
}

/** The payer form fields, shared by "register payer" and "edit payer". */
export function PayerFields({ defaults = {} }: { defaults?: PayerDefaults }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field id="payerType" label="Payer type">
        <Select id="payerType" name="payerType" defaultValue={defaults.payer_type ?? 'INDIVIDUAL'}>
          <option value="INDIVIDUAL">Individual</option>
          <option value="BUSINESS">Business</option>
        </Select>
      </Field>
      <Field id="tin" label="TIN" hint="Taxpayer Identification Number (unique)">
        <Input id="tin" name="tin" inputMode="numeric" defaultValue={defaults.tin} />
        <FieldError name="tin" />
      </Field>
      <Field id="fullName" label="Full name / business name">
        <Input id="fullName" name="fullName" defaultValue={defaults.full_name} />
        <FieldError name="fullName" />
      </Field>
      <Field id="nationalId" label="National ID (individuals)">
        <Input id="nationalId" name="nationalId" defaultValue={defaults.national_id ?? ''} />
        <FieldError name="nationalId" />
      </Field>
      <Field id="phone" label="Phone">
        <Input id="phone" name="phone" type="tel" defaultValue={defaults.phone ?? ''} />
        <FieldError name="phone" />
      </Field>
      <Field id="email" label="Email">
        <Input id="email" name="email" type="email" defaultValue={defaults.email ?? ''} />
        <FieldError name="email" />
      </Field>
      <div className="md:col-span-2">
        <Field id="address" label="Address">
          <Input id="address" name="address" defaultValue={defaults.address ?? ''} />
        </Field>
      </div>
    </div>
  );
}
