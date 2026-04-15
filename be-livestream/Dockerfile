FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --non-interactive

COPY . .
RUN yarn build

FROM node:20-alpine AS production

RUN apk add --no-cache curl

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --production=true --non-interactive && yarn cache clean

COPY --from=builder /app/dist ./dist

RUN addgroup -g 1001 -S nodejs
RUN adduser -S nestjs -u 1001
RUN chown -R nestjs:nodejs /app
USER nestjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

CMD ["node", "dist/main"]
