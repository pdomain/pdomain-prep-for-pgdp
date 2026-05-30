#!/usr/bin/env bash
set -eu

RELEASE_REPO="pdomain/pdomain-prep-for-pgdp"

. "$(dirname "$0")/release-common.sh"
pd_release_main "$@"
