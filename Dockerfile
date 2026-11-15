# spinspec container image (GHCR).
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
ENTRYPOINT ["node", "/app/dist/cli.js"]
CMD ["mcp"]
LABEL org.opencontainers.image.source="https://github.com/CloudCorpRecords/spinspec" \
      org.opencontainers.image.description="spinspec: centrifuge specs, stock and RCF sizing for remanufactured Alfa Laval centrifuges." \
      org.opencontainers.image.licenses="MIT" \
      io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/spinspec"
