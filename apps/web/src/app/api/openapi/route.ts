import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const dynamic = 'force-dynamic';

/** The OpenAPI file lives in docs/api (single source); Docker copies it next to the server. */
const CANDIDATES = [
  process.env.OPENAPI_PATH,
  path.join(process.cwd(), 'docs/api/openapi.yaml'),
  path.join(process.cwd(), '../../docs/api/openapi.yaml'),
].filter((p): p is string => Boolean(p));

/** GET /api/openapi - the OpenAPI 3 definition (YAML), used by Swagger UI at /api-docs. */
export async function GET() {
  for (const candidate of CANDIDATES) {
    try {
      const yaml = await readFile(candidate, 'utf8');
      return new Response(yaml, { headers: { 'Content-Type': 'application/yaml; charset=utf-8' } });
    } catch {
      // Try the next location.
    }
  }
  return new Response('OpenAPI definition not found', { status: 404 });
}
