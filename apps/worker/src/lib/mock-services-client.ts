/**
 * HTTP client for the simulated external systems (rates, FMIS, mobile money, SMS/email).
 * Every call has a timeout: a hung partner system must fail fast so retries can kick in,
 * instead of blocking a worker slot forever.
 */
import type { Logger } from '@ircub/platform';

const TIMEOUT_MS = 10_000;

export class ExternalServiceError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'ExternalServiceError';
  }
}

export interface FmisPostRequest {
  batchRef: string;
  businessDate: string;
  journalType: 'COLLECTION' | 'REVERSAL';
  lines: { glCode: string; debit: number; credit: number }[];
}

export class MockServicesClient {
  constructor(
    private readonly baseUrl: string,
    private readonly logger: Logger,
  ) {}

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      // Network error or timeout.
      throw new ExternalServiceError(`${method} ${path} failed: ${(error as Error).message}`, null);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      this.logger.warn({ url, status: response.status }, 'external service returned an error');
      throw new ExternalServiceError(
        `${method} ${path} returned ${response.status}: ${text.slice(0, 200)}`,
        response.status,
      );
    }
    return (await response.json()) as T;
  }

  getRates(): Promise<{ base: string; rates: Record<string, number>; timestamp: string }> {
    return this.request('GET', '/rates');
  }

  postJournal(request: FmisPostRequest): Promise<{ fmisReference: string }> {
    return this.request('POST', '/fmis/journals', request);
  }

  reverseJournal(fmisReference: string): Promise<{ fmisReference: string }> {
    return this.request('POST', `/fmis/journals/${encodeURIComponent(fmisReference)}/reverse`, {});
  }

  getPaymentStatus(
    externalRef: string,
  ): Promise<{ status: 'PENDING' | 'SUCCESS' | 'FAILED'; providerRef?: string; reason?: string }> {
    return this.request('GET', `/payments/${encodeURIComponent(externalRef)}/status`);
  }

  sendSms(to: string, message: string): Promise<{ messageId: string }> {
    return this.request('POST', '/sms', { to, message });
  }

  sendEmail(to: string, subject: string, body: string): Promise<{ messageId: string }> {
    return this.request('POST', '/email', { to, subject, body });
  }
}
