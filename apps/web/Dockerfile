FROM node:22-alpine

RUN corepack enable

WORKDIR /app

ENV CI=true

COPY . .

RUN pnpm install --frozen-lockfile && pnpm build:web

EXPOSE 5173

CMD ["pnpm", "exec", "vite", "preview", "--config", "apps/web/vite.config.ts", "--host", "0.0.0.0", "--port", "5173"]
