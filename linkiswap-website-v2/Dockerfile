# Static hosting for the V2 intent UI on Cloud Run.
#
# Served by nginx rather than a bucket so Cloud Run can host it with
# min-instances=0: idle costs nothing, and the only penalty is a ~1s
# cold start on the first request after a quiet period.

# Debian, not Alpine: a transitive `usb` dependency (Ledger support)
# compiles native code with node-gyp, which needs python3/make/g++.
# Alpine has none of those and musl breaks the build besides.
FROM node:22 AS build
WORKDIR /app

COPY package.json package-lock.json ./
# --legacy-peer-deps: RainbowKit 2.x declares a peer of wagmi@^2 while
# the app runs wagmi@3, which works at runtime but fails npm's strict
# peer resolution.
RUN npm ci --legacy-peer-deps

COPY . .

# Vite inlines VITE_* at build time, so these must be build args — a
# container env var would arrive too late and the shipped bundle would
# call the wrong host.
ARG VITE_OIF_API_BASE_URL
ARG VITE_WALLETCONNECT_PROJECT_ID
ARG VITE_GHOST_API_URL
ARG VITE_GHOST_CONTENT_KEY
# Intent parsing calls Hugging Face straight from the browser, so this
# token is inlined into the shipped bundle and is public. It is not a
# server-side secret; treat it as a throwaway and proxy the calls
# through a backend before launch.
ARG VITE_HF_ACCESS_TOKEN
ENV VITE_OIF_API_BASE_URL=$VITE_OIF_API_BASE_URL \
    VITE_WALLETCONNECT_PROJECT_ID=$VITE_WALLETCONNECT_PROJECT_ID \
    VITE_GHOST_API_URL=$VITE_GHOST_API_URL \
    VITE_GHOST_CONTENT_KEY=$VITE_GHOST_CONTENT_KEY \
    VITE_HF_ACCESS_TOKEN=$VITE_HF_ACCESS_TOKEN
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
ENV PORT=8080
EXPOSE 8080
