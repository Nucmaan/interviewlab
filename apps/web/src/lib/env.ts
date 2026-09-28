import 'server-only';
import { z } from 'zod';

/**
 * Server environment, validated once on first use. Failing fast with a clear message is better
 * than a confusing error deep inside a request when a variable is missing.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(16, 'AUTH_SECRET must be at least 16 characters'),
  CHANNEL_CALLBACK_SECRET: z.string().min(8),
  MOCK_SERVICES_URL: z.url(),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | undefined;

export function env(): ServerEnv {
  cached ??= schema.parse(process.env);
  return cached;
}
