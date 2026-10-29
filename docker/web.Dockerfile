FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN --mount=type=cache,id=finledger-npm,target=/root/.npm,sharing=locked npm ci --no-audit --prefer-offline --fetch-retries=4 --fetch-retry-mintimeout=1000 --fetch-retry-maxtimeout=10000
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w @finledger/shared && npm run build -w @finledger/web
FROM nginx:stable-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
