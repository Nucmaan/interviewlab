# Next.js web app: UI + REST API. Multi-stage build; the final image only has the standalone
# server output (no dev dependencies, no package manager) and runs as the non-root "node" user.
FROM node:24-alpine AS deps
RUN npm install -g pnpm@12.6.0
WORKDIR /repo
# Manifests first, so dependency installation is cached when only code changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/platform/package.json packages/platform/
RUN pnpm install --frozen-lockfile --filter @ircub/web...

FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/web apps/web
COPY docs/api/openapi.yaml docs/api/openapi.yaml
# Nothing connects to the database during the build, but the Prisma client needs a URL.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN pnpm --filter @ircub/db generate && pnpm --filter @ircub/web build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    OPENAPI_PATH=/app/docs/api/openapi.yaml
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/docs/api/openapi.yaml ./docs/api/openapi.yaml
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
