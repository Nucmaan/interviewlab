import { checkPasswordPolicy, PERMISSION_CODES } from '@ircub/core';
import { z } from 'zod';

/** Password policy (12+ chars, upper, lower, number, symbol) - same rule in browser and server. */
export const passwordSchema = z
  .string()
  .max(200)
  .superRefine((value, ctx) => {
    for (const problem of checkPasswordPolicy(value))
      ctx.addIssue({ code: 'custom', message: problem });
  });

const idList = z.array(z.coerce.number().int().positive()).default([]);

export const createUserSchema = z
  .object({
    email: z.email('Enter a valid email').transform((v) => v.trim().toLowerCase()),
    fullName: z.string().trim().min(3, 'Enter the full name').max(120),
    password: passwordSchema,
    roleIds: idList.refine((ids) => ids.length > 0, 'Choose at least one role'),
    payerId: z.coerce.number().int().positive().optional(),
  })
  .superRefine((value, ctx) => {
    const name = value.email.split('@')[0] ?? '';
    if (name.length >= 3 && value.password.toLowerCase().includes(name)) {
      ctx.addIssue({
        code: 'custom',
        path: ['password'],
        message: 'Do not include the email name in the password',
      });
    }
  });

export const updateUserSchema = z.object({
  userId: z.coerce.number().int().positive(),
  fullName: z.string().trim().min(3).max(120),
  roleIds: idList.refine((ids) => ids.length > 0, 'Choose at least one role'),
});

export const setUserActiveSchema = z.object({
  userId: z.coerce.number().int().positive(),
  active: z.boolean(),
});

export const resetPasswordSchema = z.object({
  userId: z.coerce.number().int().positive(),
  password: passwordSchema,
});

export const roleSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      /^[A-Z][A-Z0-9_]{2,39}$/,
      'Use 3-40 letters, numbers or underscores, starting with a letter',
    ),
  name: z.string().trim().min(3).max(80),
  description: z.string().trim().max(300).optional(),
  parentRoleId: z.coerce.number().int().positive().optional(),
});

export const rolePermissionsSchema = z.object({
  roleId: z.coerce.number().int().positive(),
  parentRoleId: z.coerce.number().int().positive().optional(),
  permissions: z.array(z.enum(PERMISSION_CODES as [string, ...string[]])).default([]),
});

export const deleteRoleSchema = z.object({ roleId: z.coerce.number().int().positive() });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'The two new passwords do not match',
  });

export const totpCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

export const disableTotpSchema = z.object({ password: z.string().min(1, 'Enter your password') });
