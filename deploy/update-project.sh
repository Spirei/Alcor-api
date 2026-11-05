#!/bin/sh
# Run from the deployment project directory; arguments are Compose global options.
set -eu
docker compose "$@" pull
docker compose "$@" run --rm --no-deps --entrypoint alcor app check-schema
docker compose "$@" up -d
