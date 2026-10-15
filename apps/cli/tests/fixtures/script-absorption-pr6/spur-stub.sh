#!/bin/bash
D="$(cd "$(dirname "$0")" && pwd)"
if [ "$1 $2" != "workflow trace" ]; then echo "stub: unsupported: $*" >&2; exit 64; fi
case "$3" in
  --workflow) cat "$D/trace-list.json" ;;
  run-a) cat "$D/trace-run-a.json" ;;
  *) echo "stub: unknown run: $3" >&2; exit 65 ;;
esac
