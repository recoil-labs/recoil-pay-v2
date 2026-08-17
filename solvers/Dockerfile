# Static hosting for the operator portal on Cloud Run.
#
# Cloud Run needs a container that listens on $PORT, so the built Vite
# bundle is served by nginx rather than uploaded to a bucket. With
# min-instances=0 an idle site costs nothing; the only cost is a ~1s
# cold start on the first request after a quiet period.

FROM node:22-alpine AS build
WORKDIR /app

# Install against the lockfile first so dependency layers cache across
# source-only changes.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Vite inlines VITE_* at build time, so the API base URL is baked into
# the bundle here rather than read at runtime.
ARG VITE_API_BASE_URL
ARG VITE_OIF_API_BASE_URL
ARG VITE_SOLVER_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_OIF_API_BASE_URL=$VITE_OIF_API_BASE_URL \
    VITE_SOLVER_API_BASE_URL=$VITE_SOLVER_API_BASE_URL
RUN npm run build

FROM nginx:1.27-alpine

# The nginx config lives in its own file rather than a Dockerfile
# heredoc: heredocs require BuildKit, and Cloud Build's default builder
# is the legacy one, which fails to parse them.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

COPY --from=build /app/dist /usr/share/nginx/html

ENV PORT=8080
EXPOSE 8080
