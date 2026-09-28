'use server';

import { z } from 'zod';
import { createAction } from '@/lib/action';
import {
  changePasswordSchema,
  createUserSchema,
  deleteRoleSchema,
  disableTotpSchema,
  resetPasswordSchema,
  rolePermissionsSchema,
  roleSchema,
  setUserActiveSchema,
  totpCodeSchema,
  updateUserSchema,
} from '../schemas/user';
import { changePassword, confirmTotp, disableTotp, startTotpSetup } from '../services/account';
import { updateConfig } from '../services/config-admin';
import {
  createRole,
  createUser,
  deleteRole,
  resetPassword,
  setUserActive,
  updateRolePermissions,
  updateUser,
} from '../services/user-admin';

export const createUserAction = createAction('users.manage', createUserSchema, createUser);
export const updateUserAction = createAction('users.manage', updateUserSchema, updateUser);
export const setUserActiveAction = createAction(
  'users.manage',
  setUserActiveSchema,
  (input, user) => setUserActive(input.userId, input.active, user),
);
export const resetPasswordAction = createAction('users.manage', resetPasswordSchema, resetPassword);

export const createRoleAction = createAction('roles.manage', roleSchema, createRole);
export const updateRolePermissionsAction = createAction(
  'roles.manage',
  rolePermissionsSchema,
  updateRolePermissions,
);
export const deleteRoleAction = createAction('roles.manage', deleteRoleSchema, (input, user) =>
  deleteRole(input.roleId, user),
);

export const updateConfigAction = createAction(
  'config.manage',
  z.object({ key: z.string(), value: z.string() }),
  (input, user) => updateConfig(input.key, input.value, user),
);

// Account security (own password, own 2FA) is available to every signed-in user.
const ANY_USER = 'authenticated';

export const changePasswordAction = createAction(ANY_USER, changePasswordSchema, (input, user) =>
  changePassword(user, input.currentPassword, input.newPassword),
);
export const startTotpAction = createAction(ANY_USER, z.object({}), (_input, user) =>
  startTotpSetup(user),
);
export const confirmTotpAction = createAction(ANY_USER, totpCodeSchema, (input, user) =>
  confirmTotp(user, input.code),
);
export const disableTotpAction = createAction(ANY_USER, disableTotpSchema, (input, user) =>
  disableTotp(user, input.password),
);
