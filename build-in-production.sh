#!/usr/bin/env bash

# Remove link overrides
node remove-pnpm-overrides.js package.json
node remove-pnpm-overrides.js web/package.json

# When CI=true as it is on render.com, removing link overrides breaks the lockfile
pnpm i --no-frozen-lockfile
(cd web && pnpm i --no-frozen-lockfile)

# Approve builds
pnpm approve-builds

# Build everything
pnpm run build
