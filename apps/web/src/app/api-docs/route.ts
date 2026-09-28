/**
 * GET /api-docs - Swagger UI for docs/api/openapi.yaml. The Swagger UI files are served by this
 * app (./[file]/route.ts), so the page also works without internet access.
 */
export const dynamic = 'force-static';

const HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>IRCUB API documentation</title>
    <link rel="stylesheet" href="/api-docs/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="/api-docs/swagger-ui-bundle.js"></script>
    <script src="/api-docs/init.js"></script>
  </body>
</html>`;

export function GET() {
  return new Response(HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
