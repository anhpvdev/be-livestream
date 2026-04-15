FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache docker-cli

COPY package.json ./
RUN yarn install

COPY tsconfig.json ./
COPY src ./src

RUN yarn build

EXPOSE 8090

CMD ["yarn", "start"]
