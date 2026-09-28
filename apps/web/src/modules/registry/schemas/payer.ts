import { z } from 'zod';

const optionalText = (max: number) => z.string().trim().max(max).optional();

export const payerSchema = z
  .object({
    payerType: z.enum(['INDIVIDUAL', 'BUSINESS']),
    fullName: z.string().trim().min(3, 'Enter the full name').max(150),
    tin: z
      .string()
      .trim()
      .regex(/^\d{9,12}$/, 'TIN must be 9 to 12 digits'),
    nationalId: optionalText(30),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[\d\s-]{7,20}$/, 'Enter a valid phone number')
      .optional(),
    email: z.email('Enter a valid email').optional(),
    address: optionalText(200),
  })
  .refine((v) => v.payerType === 'BUSINESS' || v.nationalId, {
    path: ['nationalId'],
    message: 'National ID is required for individuals',
  });

export type PayerInput = z.infer<typeof payerSchema>;

export const updatePayerSchema = z.intersection(
  payerSchema,
  z.object({ payerId: z.coerce.number().int().positive() }),
);

export const reviewDuplicateSchema = z.object({
  flagId: z.coerce.number().int().positive(),
  decision: z.enum(['CONFIRMED_DUPLICATE', 'NOT_DUPLICATE']),
});
