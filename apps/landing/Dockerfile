FROM node:22-alpine AS builder

WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.json ./
COPY packages/ ./packages/
COPY apps/landing/ ./apps/landing/

RUN pnpm install --frozen-lockfile

RUN pnpm turbo build --filter=landing...

FROM nginx:alpine

COPY apps/landing/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /repo/apps/landing/dist /usr/share/nginx/html

EXPOSE 80
