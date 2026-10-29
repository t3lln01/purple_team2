#!/bin/bash
set -e
pnpm install --frozen-lockfile
python3 -m pip install --user -r artifacts/api-server/requirements.txt
