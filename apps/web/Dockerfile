FROM node:22-alpine AS builder

WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.json ./
COPY packages/ ./packages/
COPY apps/web/ ./apps/web/

RUN pnpm install --frozen-lockfile

ARG VITE_WALLETCONNECT_PROJECT_ID
ARG VITE_API_URL
ENV VITE_WALLETCONNECT_PROJECT_ID=$VITE_WALLETCONNECT_PROJECT_ID
ENV VITE_API_URL=$VITE_API_URL

RUN pnpm turbo build --filter=web...

FROM nginx:alpine

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /repo/apps/web/dist /usr/share/nginx/html

EXPOSE 80
