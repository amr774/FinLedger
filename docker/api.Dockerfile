FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN --mount=type=cache,id=finledger-npm,target=/root/.npm,sharing=locked npm ci --no-audit --prefer-offline --fetch-retries=4 --fetch-retry-mintimeout=1000 --fetch-retry-maxtimeout=10000
COPY . .
RUN DATABASE_URL=postgresql://unused:unused@localhost/unused npm run db:generate && npm run build -w @finledger/shared && npm run build -w @finledger/api
USER node
EXPOSE 3000
CMD ["npm","run","start","-w","@finledger/api"]
