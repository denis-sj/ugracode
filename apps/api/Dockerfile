FROM node:22-alpine

RUN corepack enable

WORKDIR /app

ENV CI=true

COPY . .

RUN pnpm install --frozen-lockfile

EXPOSE 3001

CMD ["sh", "-c", "pnpm migrate && pnpm seed && pnpm exec tsx apps/api/src/index.ts"]
