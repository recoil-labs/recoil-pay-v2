# Railway's automatic builder cannot pick an app out of an npm-workspaces
# monorepo — it asks for an Nx hint that does not apply here — so the build
# is spelled out instead. One image: the API serves its own routes and the
# built web bundle from WEB_DIST.
FROM node:22-alpine

WORKDIR /app

# Install with the lockfile first, so dependency layers survive source edits.
COPY package.json package-lock.json ./
COPY web/package.json ./web/
COPY api/package.json ./api/
RUN npm ci

COPY . .

# Build the site; the API runs from TypeScript through tsx, as it does locally.
RUN npm run build -w web

ENV NODE_ENV=production
ENV WEB_DIST=/app/web/dist
ENV PORT=8787
EXPOSE 8787

CMD ["npm", "start", "-w", "api"]
