FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json ./
RUN yarn install --non-interactive

COPY . .
RUN yarn build

FROM node:20-alpine AS production

RUN apk add --no-cache ffmpeg curl

WORKDIR /app

COPY package.json ./
RUN yarn install --production=true --non-interactive && yarn cache clean

COPY --from=builder /app/dist ./dist

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

CMD ["node", "dist/main"]
