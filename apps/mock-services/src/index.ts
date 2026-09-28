/**
 * One server simulating every external system IRCUB talks to. Behaviour is configurable so
 * retries and failures can be demonstrated:
 *   MOCK_FAILURE_RATE   share of requests answered with 503 / declined (default 0.1)
 *   MOCK_DELAY_MS       average response delay (default 300)
 *   POST /admin/config  change the above at runtime, or switch FMIS "down" completely
 */
import Fastify from 'fastify';
import { z } from 'zod';
import { registerChannelRoutes } from './routes/channels';
import { registerFmisRoutes } from './routes/fmis';
import { registerMessagingRoutes } from './routes/messaging';
import { runtime } from './state';

// Fastify's built-in logger is pino, so lines have the same JSON shape as the other services.
// Per-request logging is off: at load-test volumes it would drown the useful lines.
const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    base: { service: 'mock-services' },
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
  },
  disableRequestLogging: true,
});
const logger = app.log;

const adminSchema = z.object({
  failureRate: z.number().min(0).max(1).optional(),
  delayMs: z.number().int().min(0).max(60_000).optional(),
  callbackDropRate: z.number().min(0).max(1).optional(),
  fmisDown: z.boolean().optional(),
});

app.get('/health', async () => ({ status: 'ok' }));
app.get('/admin/config', async () => runtime);
app.post('/admin/config', async (request, reply) => {
  const parsed = adminSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
  Object.assign(runtime, parsed.data);
  logger.info({ runtime }, 'mock configuration changed');
  return runtime;
});

registerChannelRoutes(app, logger);
registerFmisRoutes(app);
registerMessagingRoutes(app);

const port = Number(process.env.PORT ?? process.env.MOCK_SERVICES_PORT ?? 4000);
app.listen({ port, host: '0.0.0.0' }).catch((error: unknown) => {
  logger.fatal({ err: error }, 'mock services failed to start');
  process.exit(1);
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
