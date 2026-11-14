FROM node:22-alpine

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/core/package.json packages/core/
COPY packages/adapters/package.json packages/adapters/
COPY packages/db/package.json packages/db/
COPY packages/testkit/package.json packages/testkit/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm build:web

EXPOSE 5173

CMD ["pnpm", "exec", "vite", "preview", "--config", "apps/web/vite.config.ts", "--host", "0.0.0.0", "--port", "5173"]
