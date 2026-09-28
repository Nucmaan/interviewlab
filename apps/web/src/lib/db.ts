import 'server-only';
import { getPrisma } from '@ircub/db';

/** Single Prisma client for the web process (see packages/db/src/index.ts). */
export const prisma = getPrisma();
