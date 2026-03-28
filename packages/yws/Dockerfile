FROM node:20-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy all package manifests so pnpm workspace is valid
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/yws/package.json     ./packages/yws/
COPY packages/api/package.json     ./packages/api/
COPY packages/shared/package.json  ./packages/shared/
COPY packages/web/package.json     ./packages/web/

# Hoisted linker: flat node_modules, no .pnpm symlinks.
# Install only yws + root devDeps (typescript, vitest).
RUN echo "node-linker=hoisted" > .npmrc && \
    pnpm install --frozen-lockfile --filter @drawroom/yws --filter "{.}"

COPY packages/yws ./packages/yws

# Run tsc from root node_modules/.bin (avoids package-script PATH issues)
RUN node_modules/.bin/tsc -p packages/yws/tsconfig.json

ENV NODE_ENV=production
EXPOSE 1234

HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:1234/ || exit 1

CMD ["node", "packages/yws/dist/server.js"]
