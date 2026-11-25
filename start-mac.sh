#!/bin/sh
cd "$(dirname "$0")" || exit 1
exec node --env-file=.env src/server.js
