#!/usr/bin/env bash
set -euo pipefail
# Pinned upstream release and independently recorded archive digest. No action
# license, credentials, or permissive continue-on-error path is required.
if [ "$(git rev-parse --is-shallow-repository)" != false ]; then
  echo 'Secret scan requires complete Git ancestry; shallow repositories are rejected'
  exit 1
fi
# Git remerge diffs support two-parent merges. Fail closed on unsupported merge
# shapes rather than silently omitting a change introduced by an octopus merge.
octopus_commits="$(git rev-list --min-parents=3 HEAD)"
if [ -n "$octopus_commits" ]; then
  echo 'Secret scan requires two-parent merge history; octopus merges are rejected'
  exit 1
fi
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
# In 8.30.1, explicit log options replace the default --all. The mandatory gate
# scans the entire checkout ancestry, including both parents of a CI PR merge;
# unrelated fetched refs belong to a separate, explicit all-ref diagnostic.
# Remerge diffs also expose secrets introduced only by a two-parent merge.
echo 'Secret-scanner failure canary PASS; scanning complete HEAD ancestry with merge diffs'
"$scanner_dir/gitleaks" git . --log-opts="--full-history --diff-merges=remerge HEAD" --redact=100 --no-banner --log-level error --ignore-gitleaks-allow
