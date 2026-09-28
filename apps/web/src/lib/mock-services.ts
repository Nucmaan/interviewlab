import 'server-only';
import { env } from '@/lib/env';
import { DomainError } from '@/lib/errors';
import { logger } from '@/lib/logger';

const TIMEOUT_MS = 10_000;

/**
 * Calls to the simulated partner systems made by the web app (initiating a mobile money payment,
 * downloading a channel statement, reading FMIS totals). A failure becomes a clear user message
 * instead of an unhandled error.
 */
export async function callMockService<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  what = 'The partner system',
): Promise<T> {
  const url = `${env().MOCK_SERVICES_URL}${path}`;
  try {
    const response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!response.ok) {
      logger.warn({ url, status: response.status }, 'mock service error');
      throw new DomainError(
        `${what} is not available right now (HTTP ${response.status}). Please try again.`,
        502,
      );
    }
    const type = response.headers.get('content-type') ?? '';
    return (type.includes('application/json') ? await response.json() : await response.text()) as T;
  } catch (error) {
    if (error instanceof DomainError) throw error;
    logger.warn({ url, err: (error as Error).message }, 'mock service unreachable');
    throw new DomainError(`${what} did not respond. Please try again.`, 504);
  }
}
