#!/bin/bash
set -e
bun install --frozen-lockfile
bun --filter @workspace/db run push