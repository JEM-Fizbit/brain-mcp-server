# syntax=docker/dockerfile:1

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ARG GIT_SHA=unknown
ARG APP_VERSION=unknown
LABEL org.opencontainers.image.revision=$GIT_SHA \
  org.opencontainers.image.version=$APP_VERSION

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY config ./config
COPY README.md LICENSE ./
COPY scripts/fly-entrypoint.sh ./scripts/fly-entrypoint.sh
RUN chmod +x ./scripts/fly-entrypoint.sh

EXPOSE 8080
ENTRYPOINT ["/app/scripts/fly-entrypoint.sh"]
CMD ["npm", "start"]
