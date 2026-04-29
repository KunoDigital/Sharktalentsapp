#!/bin/bash
# Genera un secret hex de 32 bytes (64 chars) para env vars.
# Uso: scripts/generate-secret.sh

node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
