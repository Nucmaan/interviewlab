import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getAbsoluteFSPath } from 'swagger-ui-dist';

export const dynamic = 'force-static';

// Only these files may be served - never an arbitrary path from the URL.
const FILES: Record<string, string> = {
  'swagger-ui.css': 'text/css; charset=utf-8',
  'swagger-ui-bundle.js': 'application/javascript; charset=utf-8',
};

// Kept in a separate file (not inline) so a strict Content-Security-Policy can block inline scripts.
const INIT = `window.ui = SwaggerUIBundle({ url: '/api/openapi', dom_id: '#swagger-ui', deepLinking: true });`;

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (file === 'init.js') {
    return new Response(INIT, {
      headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
    });
  }
  const type = FILES[file];
  if (!type) return new Response('Not found', { status: 404 });
  const body = await readFile(path.join(getAbsoluteFSPath(), file));
  return new Response(new Uint8Array(body), {
    headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400' },
  });
}

export function generateStaticParams() {
  return [...Object.keys(FILES), 'init.js'].map((file) => ({ file }));
}
