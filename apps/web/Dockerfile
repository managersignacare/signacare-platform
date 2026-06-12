FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY apps/web/package*.json ./apps/web/

RUN npm ci --workspaces --include-workspace-root

COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

# Production web containers should use the same-origin nginx proxy.
# Direct API-host URLs are brittle here: they bypass the proxy and can
# accidentally drop the API version prefix.
ARG VITE_API_URL=/api/v1
ARG VITE_SCRIBE_LIVE_TRANSCRIPT=false
ARG VITE_SCRIBE_ASYNC_AMBIENT=true
ARG VITE_SCRIBE_ASYNC_AMBIENT_MIN_SECONDS=180
ARG VITE_BUILD_SHA=dev
ARG VITE_ASSET_VERSION=dev
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_SCRIBE_LIVE_TRANSCRIPT=${VITE_SCRIBE_LIVE_TRANSCRIPT}
ENV VITE_SCRIBE_ASYNC_AMBIENT=${VITE_SCRIBE_ASYNC_AMBIENT}
ENV VITE_SCRIBE_ASYNC_AMBIENT_MIN_SECONDS=${VITE_SCRIBE_ASYNC_AMBIENT_MIN_SECONDS}
ENV VITE_BUILD_SHA=${VITE_BUILD_SHA}
ENV VITE_ASSET_VERSION=${VITE_ASSET_VERSION}

RUN npm run build --workspace=apps/web

FROM nginx:alpine
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf.template
COPY apps/web/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]

EXPOSE 80
