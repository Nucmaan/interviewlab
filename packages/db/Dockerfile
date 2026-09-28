# One-shot "migrate" image: prisma migrate deploy -> raw SQL in /sql -> seed.
FROM node:24-alpine AS deps
RUN npm install -g pnpm@12.6.0
WORKDIR /repo
# Copy only manifests first so dependency installation is cached between code changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile --prod --filter @ircub/db...

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY packages/db packages/db
COPY sql sql
# prisma generate does not connect, but the config requires DATABASE_URL to be defined.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build pnpm --filter @ircub/db generate

# Final image: plain Node, no package manager, non-root user.
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build --chown=node:node /repo /repo
USER node
WORKDIR /repo/packages/db
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && ./node_modules/.bin/tsx scripts/apply-sql.ts && ./node_modules/.bin/tsx scripts/seed.ts"]
