FROM node:22-alpine

RUN corepack enable

WORKDIR /app

ENV CI=true

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.json ./
COPY packages ./packages
COPY apps ./apps
COPY modules ./modules
COPY data ./data
COPY scripts ./scripts
COPY eslint.config.js vitest.config.ts .prettierrc.json ./

RUN pnpm install --frozen-lockfile && pnpm build:web && chown -R node:node /app

USER node

EXPOSE 5173

CMD ["pnpm", "exec", "vite", "preview", "--config", "apps/web/vite.config.ts", "--host", "0.0.0.0", "--port", "5173"]
