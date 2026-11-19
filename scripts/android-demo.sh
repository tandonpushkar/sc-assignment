#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npx expo run:android "$@"
