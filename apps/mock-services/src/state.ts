/**
 * In-memory state of the simulated partners, saved to a JSON file so it survives a container
 * restart (the file lives on a Docker volume). Good enough for a simulator; not a database.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface ChannelTransaction {
  externalRef: string;
  providerRef: string;
  channel: 'BANK' | 'MOBILE_MONEY';
  amount: number;
  currency: 'USD' | 'SOS';
  controlNumber?: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  reason?: string;
  createdAt: string;
  completedAt?: string;
}

export interface FmisJournal {
  fmisReference: string;
  batchRef: string;
  businessDate: string;
  journalType: 'COLLECTION' | 'REVERSAL';
  lines: { glCode: string; debit: number; credit: number }[];
  reversed: boolean;
  postedAt: string;
}

export interface SentMessage {
  id: string;
  kind: 'SMS' | 'EMAIL';
  to: string;
  subject?: string;
  body: string;
  sentAt: string;
}

export interface RuntimeConfig {
  failureRate: number;
  delayMs: number;
  /** Share of successful mobile money payments whose callback is "lost" (status check needed). */
  callbackDropRate: number;
  fmisDown: boolean;
}

interface PersistedState {
  transactions: ChannelTransaction[];
  journals: FmisJournal[];
  messages: SentMessage[];
}

const dataDir = process.env.MOCK_DATA_DIR ?? path.resolve(import.meta.dirname, '../.data');
const dataFile = path.join(dataDir, 'mock-state.json');

function load(): PersistedState {
  try {
    return JSON.parse(readFileSync(dataFile, 'utf8')) as PersistedState;
  } catch {
    return { transactions: [], journals: [], messages: [] };
  }
}

export const state = load();

export const runtime: RuntimeConfig = {
  failureRate: Number(process.env.MOCK_FAILURE_RATE ?? 0.1),
  delayMs: Number(process.env.MOCK_DELAY_MS ?? 300),
  callbackDropRate: Number(process.env.MOCK_CALLBACK_DROP_RATE ?? 0.2),
  fmisDown: false,
};

let saveTimer: NodeJS.Timeout | undefined;

/** Debounced save: many changes in a burst cause one file write. */
export function persist(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    mkdirSync(dataDir, { recursive: true });
    // Keep the file small: only the most recent messages are useful.
    state.messages = state.messages.slice(-500);
    writeFileSync(dataFile, JSON.stringify(state));
  }, 500);
}

/** Random delay around the configured value (0.5x - 1.5x) to feel like a real network. */
export async function simulateLatency(): Promise<void> {
  const ms = runtime.delayMs * (0.5 + Math.random());
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function shouldFail(): boolean {
  return Math.random() < runtime.failureRate;
}
