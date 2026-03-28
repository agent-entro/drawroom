FROM node:20-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy all package manifests so pnpm workspace is valid
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/api/package.json     ./packages/api/
COPY packages/shared/package.json  ./packages/shared/
COPY packages/yws/package.json     ./packages/yws/
COPY packages/web/package.json     ./packages/web/

# Hoisted linker: flat node_modules, no .pnpm symlinks.
# Install api + shared + root devDeps (typescript, tsc-alias).
RUN echo "node-linker=hoisted" > .npmrc && \
    pnpm install --frozen-lockfile --filter @drawroom/api... --filter "{.}"

COPY packages/shared ./packages/shared
COPY packages/api    ./packages/api

# Run tsc from root node_modules/.bin (avoids package-script PATH issues)
RUN node_modules/.bin/tsc -p packages/shared/tsconfig.json && \
    node_modules/.bin/tsc -p packages/api/tsconfig.json

ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "packages/api/dist/index.js"]
