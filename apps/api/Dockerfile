FROM node:22-alpine

RUN corepack enable

WORKDIR /app

ENV CI=true

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.json ./
COPY packages ./packages
COPY apps ./apps
COPY modules ./modules
COPY data ./data
COPY testset ./testset
COPY reports ./reports
COPY scripts ./scripts
COPY eslint.config.js vitest.config.ts .prettierrc.json ./

RUN pnpm install --frozen-lockfile && chown -R node:node /app

USER node

EXPOSE 3001

CMD ["sh", "-c", "pnpm migrate && pnpm seed && pnpm exec tsx apps/api/src/index.ts"]
