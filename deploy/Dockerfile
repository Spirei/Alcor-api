FROM node:22-bookworm-slim AS web
WORKDIR /source
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY apps/web apps/web
RUN npm run build

FROM ghcr.io/astral-sh/uv:0.12.23 AS uv
FROM python:3.12-slim-bookworm AS runtime
ARG PG_MAJOR=16
ARG APP_VERSION
ARG SOURCE_REVISION
ARG SCHEMA_HASH
RUN case "$PG_MAJOR" in 16|17|18) ;; *) exit 1 ;; esac \
    && apt-get update && apt-get install -y --no-install-recommends curl ca-certificates gnupg libstdc++6 libcairo2 \
    && curl --fail --silent --show-error --proto '=https' --tlsv1.2 https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/keyrings/postgresql.asc \
    && gpg --show-keys --with-colons /usr/share/keyrings/postgresql.asc | grep -q '^fpr:::::::::B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8:' \
    && echo 'deb [signed-by=/usr/share/keyrings/postgresql.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main' > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update && apt-get install -y --no-install-recommends "postgresql-client-$PG_MAJOR" \
    && apt-get purge -y --auto-remove curl gnupg && rm -rf /var/lib/apt/lists/*
COPY --from=uv /uv /usr/local/bin/uv
# Configuration-only JS regex compiler; no npm or old Web runtime.
COPY --from=web /usr/local/bin/node /usr/local/bin/node
RUN node --max-old-space-size=16 -e "if(process.versions.node.split('.')[0]!=='22')process.exit(1)"
WORKDIR /app
COPY pyproject.toml uv.lock ./
COPY backend backend
RUN APP_VERSION="$APP_VERSION" python -c "import os,tomllib; assert tomllib.load(open('pyproject.toml','rb'))['project']['version']==os.environ['APP_VERSION']"
RUN uv sync --frozen --no-dev --no-editable && groupadd -g 10001 alcor && useradd -u 10001 -g alcor -M alcor && mkdir -p /app/run && chown alcor:alcor /app/run
COPY migrations migrations
COPY contracts/migration-register.json contracts/migration-register.json
COPY contracts/api-capabilities.json contracts/api-capabilities.json
COPY contracts/releases.json contracts/releases.json
COPY deploy/supervisord.conf deploy/supervisord.conf
COPY deploy/entrypoint.py deploy/entrypoint.py
COPY --from=web /source/apps/web/dist apps/web/dist
ENV PATH="/app/.venv/bin:$PATH" ALCOR_ROOT=/app ALCOR_RUNTIME=/app/run ALCOR_PYTHON=/app/.venv/bin/python ALCOR_BIND_HOST=0.0.0.0 ALCOR_PORT=8080 PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
ENV ALCOR_PG_TOOLS_DIR=/usr/lib/postgresql/${PG_MAJOR}/bin
ENV ALCOR_RELEASE_VERSION=${APP_VERSION} ALCOR_SOURCE_REVISION=${SOURCE_REVISION}
LABEL org.opencontainers.image.version=${APP_VERSION} org.opencontainers.image.revision=${SOURCE_REVISION} org.alcor.schema=${SCHEMA_HASH}
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=6s --start-period=45s --retries=3 CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health/container', timeout=5).read()"]
ENTRYPOINT ["python", "/app/deploy/entrypoint.py"]
CMD ["supervisord", "-c", "/app/deploy/supervisord.conf"]
