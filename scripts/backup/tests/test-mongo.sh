#!/bin/bash
# Local test of the Mongo backup hooks and restore test, in a throwaway mongo:8.0 container.
# PYTHON_HOME: a standalone Python install to mount (the image has none).
here="$(cd "$(dirname "$0")/.." && pwd)"
PY="${PYTHON_HOME:?set PYTHON_HOME to a standalone python install}"
docker run --rm -v "$here":/src:ro -v "$here":/opt/sbc-backup:ro -v "$PY":"$PY":ro --entrypoint bash mongo:8.0 \
  -c "ln -sf $PY/bin/python3 /usr/local/bin/python3 && bash /src/tests/run-mongo-test.sh"
