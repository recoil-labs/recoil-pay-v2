# Production Dockerfile for OIF Aggregator using Chainguard secure images
FROM --platform=${BUILDPLATFORM} cgr.dev/chainguard/rust:latest-dev@sha256:99328709974cc55f9c1bef7ea2089ee0c31636d8a792c2b3549dadfd31faf001 AS base

USER root

# Install system dependencies needed for compilation
RUN apk update && apk add --no-cache \
    pkgconf \
    openssl-dev \
    ca-certificates \
    perl

# Set PKG_CONFIG_PATH for proper linking
ENV PKG_CONFIG_PATH=/usr/lib/pkgconfig

# Install cargo-chef reproducibly so CI does not resolve crates that require a newer rustc
RUN cargo install --locked cargo-chef

WORKDIR /app

# Planner stage - analyze dependencies
FROM base AS planner

# Copy workspace files to analyze dependencies
COPY Cargo.toml Cargo.lock ./
COPY rust-toolchain.toml ./
COPY crates/ ./crates/
COPY src/ ./src/

# Generate dependency recipe
RUN cargo chef prepare --recipe-path recipe.json

# Build stage - compile dependencies and application with cache mounts
FROM base AS builder

# Copy dependency recipe from planner stage
COPY --from=planner /app/recipe.json recipe.json

# Build dependencies with cache mounts for maximum speed. The
# `postgres` feature enables `PostgresStore` (see crates/storage); without
# it the binary silently falls back to `MemoryStore` even when
# `DATABASE_URL` is set, which means operator/quote rows live in RAM and
# vanish on every redeploy.
#
# `openapi` serves the partner-facing spec at /api-docs/openapi.json and
# Swagger UI at /swagger-ui. Without it those routes simply do not exist
# (404), so developers have nothing to test against.
RUN cargo chef cook --release --features postgres,openapi --recipe-path recipe.json

# Copy source code and build the application
COPY Cargo.toml Cargo.lock ./
COPY rust-toolchain.toml ./
COPY crates/ ./crates/
COPY src/ ./src/

# Build the aggregator in release mode with cache mounts. Same feature
# flag as the cook step above so the two binaries are linked against the
# same set of crates.
RUN cargo build --release --features postgres,openapi && \
    cp /app/target/release/oif-aggregator /usr/local/bin/oif-aggregator

# Build the fill-worker (multi-tenant operator binary). Render deploys
# both services from this single image; the `recoil-fill-worker`
# background worker overrides the entrypoint via
# `dockerCommand: /usr/local/bin/fill-worker`. Operators don't run this
# binary themselves — it's hosted by us, signs fills via the aggregator's
# /sign-fill endpoint using each operator's encrypted fill-wallet key.
RUN cargo build --release -p fill-worker && \
    cp /app/target/release/fill-worker /usr/local/bin/fill-worker

# Runtime stage - using Chainguard's minimal Wolfi base
FROM cgr.dev/chainguard/wolfi-base:latest

# Install only runtime dependencies (minimal set)
USER root
RUN apk add --no-cache \
    ca-certificates \
    libssl3

# Remove apk tools for security (reduces attack surface)
RUN apk del apk-tools

# Create application directory
WORKDIR /app

# Copy the binaries from builder stage with proper ownership
COPY --from=builder --chown=nonroot:nonroot /usr/local/bin/oif-aggregator /usr/local/bin/oif-aggregator
COPY --from=builder --chown=nonroot:nonroot /usr/local/bin/fill-worker /usr/local/bin/fill-worker

# Copy configuration files with proper ownership
COPY --chown=nonroot:nonroot config/ ./config/

# Make binaries executable
RUN chmod +x /usr/local/bin/oif-aggregator /usr/local/bin/fill-worker

# Switch to non-root user for runtime
USER nonroot

# Expose the application port
EXPOSE 4000

# Set the entrypoint
ENTRYPOINT ["/usr/local/bin/oif-aggregator"]
