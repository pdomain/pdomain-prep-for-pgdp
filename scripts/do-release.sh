#!/usr/bin/env bash
set -eu

RELEASE_REPO="pdomain/pdomain-prep-for-pgdp"

. "$(dirname "$0")/release-common.sh"
pdomain_release_main "$@"
