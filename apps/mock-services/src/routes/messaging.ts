/**
 * Mock SMS and email gateway. Messages are recorded, never really sent.
 *
 *   POST /sms      { to, message }
 *   POST /email    { to, subject, body }
 *   GET  /messages latest messages (to show in a demo that the customer was notified)
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { persist, shouldFail, simulateLatency, state } from '../state';

const smsSchema = z.object({ to: z.string().min(3), message: z.string().min(1).max(1000) });
const emailSchema = z.object({
  to: z.string().min(3),
  subject: z.string().min(1),
  body: z.string().min(1),
});

export function registerMessagingRoutes(app: FastifyInstance): void {
  app.post('/sms', async (request, reply) => {
    await simulateLatency();
    if (shouldFail()) return reply.code(503).send({ error: 'SMS gateway unavailable' });
    const parsed = smsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const id = `SMS-${randomUUID().slice(0, 8)}`;
    state.messages.push({
      id,
      kind: 'SMS',
      to: parsed.data.to,
      body: parsed.data.message,
      sentAt: new Date().toISOString(),
    });
    persist();
    return { messageId: id };
  });

  app.post('/email', async (request, reply) => {
    await simulateLatency();
    if (shouldFail()) return reply.code(503).send({ error: 'Email gateway unavailable' });
    const parsed = emailSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const id = `EML-${randomUUID().slice(0, 8)}`;
    state.messages.push({
      id,
      kind: 'EMAIL',
      to: parsed.data.to,
      subject: parsed.data.subject,
      body: parsed.data.body,
      sentAt: new Date().toISOString(),
    });
    persist();
    return { messageId: id };
  });

  app.get('/messages', async () => state.messages.slice(-100).reverse());
}
