#!/usr/bin/env bash
set -euo pipefail
# Pinned upstream release and independently recorded archive digest. No action
# license, credentials, or permissive continue-on-error path is required.
scanner_dir="$(mktemp -d)"
trap 'rm -rf "$scanner_dir"' EXIT
curl --fail --silent --show-error --location --retry 3 \
  https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz \
  --output "$scanner_dir/gitleaks.tar.gz"
printf '%s  %s\n' '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb' "$scanner_dir/gitleaks.tar.gz" | sha256sum --check --status
tar -xzf "$scanner_dir/gitleaks.tar.gz" -C "$scanner_dir" gitleaks
# Prove scanner findings fail, with fabricated test input and fully redacted output.
openssl genpkey -algorithm ED25519 -out "$scanner_dir/canary.txt" 2>/dev/null
set +e
"$scanner_dir/gitleaks" dir "$scanner_dir/canary.txt" --redact=100 --no-banner --log-level error > /dev/null 2>&1
canary_status=$?
set -e
if [ "$canary_status" -ne 1 ]; then echo 'Secret-scanner failure canary did not fail as expected'; exit 1; fi
"$scanner_dir/gitleaks" git . --redact=100 --no-banner --log-level error --ignore-gitleaks-allow
