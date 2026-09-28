# Simulated external systems (bank, mobile money, rates, FMIS, SMS/email). Non-root runtime.
FROM node:24-alpine AS deps
RUN npm install -g pnpm@12.6.0
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/mock-services/package.json apps/mock-services/
COPY packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile --prod --filter @ircub/mock-services...

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY apps/mock-services apps/mock-services

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build --chown=node:node /repo /repo
# State file lives on a Docker volume mounted at /data.
RUN mkdir -p /data && chown node:node /data
USER node
WORKDIR /repo/apps/mock-services
EXPOSE 4000
CMD ["./node_modules/.bin/tsx", "src/index.ts"]
