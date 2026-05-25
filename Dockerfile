FROM node:24-alpine

WORKDIR /app

RUN apk add --no-cache fontconfig ttf-dejavu

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY web ./web
COPY data ./data
COPY scripts ./scripts

EXPOSE 3000

CMD ["node", "src/server.js"]
