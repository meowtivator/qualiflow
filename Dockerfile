FROM node:22-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/adapter-mock/package.json packages/adapter-mock/package.json
COPY packages/adapter-alibaba/package.json packages/adapter-alibaba/package.json
COPY packages/adapter-chat/package.json packages/adapter-chat/package.json
COPY packages/adapter-instagram/package.json packages/adapter-instagram/package.json
COPY packages/adapter-telegram/package.json packages/adapter-telegram/package.json
COPY packages/adapter-whatsapp/package.json packages/adapter-whatsapp/package.json
RUN pnpm install --frozen-lockfile

FROM base AS builder
# deps 단계의 전체 트리(node_modules 포함)를 가져온 뒤 소스를 덮어쓴다.
# (패키지가 추가돼도 안 깨지도록 패키지별 node_modules를 일일이 나열하지 않는다.)
COPY --from=deps /app/ ./
COPY . .
# ★NEXT_PUBLIC_* 는 빌드타임에 브라우저 번들로 인라인된다 → 빌드 인자로 받아 build 전에 ENV로 노출한다.
#   (없으면 클라이언트가 Supabase에 못 붙는다. 비공개 키 SUPABASE_SECRET_KEY/QUALIFLOW_PAIRING_PEPPER 는
#    빌드가 아니라 '런타임' env(compose)로 준다.)
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
RUN pnpm run build

FROM base AS runner
ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=builder /app ./
EXPOSE 3000
CMD ["pnpm", "--filter", "@qualiflow/web", "start"]
