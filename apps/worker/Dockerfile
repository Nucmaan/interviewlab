# BullMQ worker. Runs the TypeScript source with tsx (a small runtime dependency) so the worker
# and the shared packages need no separate build step. Non-root, no package manager at runtime.
FROM node:24-alpine AS deps
RUN npm install -g pnpm@12.6.0
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/platform/package.json packages/platform/
RUN pnpm install --frozen-lockfile --prod --filter @ircub/worker...

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/worker apps/worker
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build pnpm --filter @ircub/db generate

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build --chown=node:node /repo /repo
USER node
WORKDIR /repo/apps/worker
CMD ["./node_modules/.bin/tsx", "src/index.ts"]
