# ---------- Builder stage ----------
FROM node:18-alpine AS builder

# Install build dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Copy source files
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY schemas ./schemas
COPY vendor ./vendor
COPY src/types/generated ./src/types/generated

# Generate TypeScript types from MOVA schemas
RUN npm run gen:types

# Build the project
RUN npm run build

# ---------- Runtime stage ----------
FROM node:18-alpine AS runtime

WORKDIR /app

# Copy only production dependencies
COPY package.json package-lock.json ./
RUN npm ci --only=production

# Copy compiled output and generated types
COPY --from=builder /app/build ./build
COPY --from=builder /app/src/types/generated ./src/types/generated

# Expose the default port (adjust if your agent uses a different one)
EXPOSE 3000

# Set the entry point (CLI help by default)
CMD ["node", "build/tools/mova-agent.js", "--help"]
