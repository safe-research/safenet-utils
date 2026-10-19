#!/usr/bin/env bash
#
# propose-safenet.sh PATH...
#
# Proposes test transactions directly to Safenet, through the relayer's
# full-transaction endpoint (SAFENET_RELAYER_URL), for the Safe under test.
# PATH is a test transaction file or a directory of them. Each transaction is
# proposed on the chain of its file, for SAFE_ADDRESS on that chain, with the
# nonce and owners of the Safe on that chain (see safe_info). For each file,
# prints the case, its expected verdict and the Safenet explorer link of the
# proposed transaction, where the Sentinel votes can be compared with it.
#
# The relayer accepts every request with an empty 202, even invalid ones, so
# the explorer link is the only way to confirm that a proposal landed. Only a
# non-2xx response is treated as an error.

set -euo pipefail

# shellcheck source=../lib/common.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/../lib/common.sh"

(( $# )) || die "usage: propose-safenet.sh PATH..."

load_dotenv
require_env SAFE_ADDRESS SAFENET_RELAYER_URL
explorer_url=${SAFENET_EXPLORER_URL:-https://safenet-explorer.eth.limo}

collect_files "$@"

echo "Proposing ${#FILES[@]} transaction(s) for Safe $SAFE_ADDRESS to $SAFENET_RELAYER_URL"

# The Safe is read once per chain. A chain on which it can't be read is
# remembered as empty, so that its files fail without another request.
declare -A infos=()
failed=0
for file in "${FILES[@]}"; do
  chain_id=$(cast to-dec "$(jq -r .request.transaction.chainId "$file")")
  if [[ ! -v infos[$chain_id] ]]; then
    infos[$chain_id]=$(safe_info "$chain_id") || infos[$chain_id]=
    [[ -z ${infos[$chain_id]} ]] \
      || printf '\nSafe on chain %s: nonce %s\n' "$chain_id" "$(jq -r .nonce <<<"${infos[$chain_id]}")"
  fi
  if [[ -z ${infos[$chain_id]} ]]; then
    echo
    basename "$file" .json
    echo "  error:      could not read the Safe on chain $chain_id" >&2
    failed=$((failed + 1))
    continue
  fi

  tx=$(load_safe_tx "$file" "${infos[$chain_id]}")
  safe_tx_hash=$(safe_tx_hash "$tx")
  expected=$(
    jq -r '.response // empty | .verdict + (if .rule then " (\(.rule))" else "" end)' "$file"
  )

  status=$(
    curl -sS -o /dev/null -w '%{http_code}' -X POST \
      -H 'Content-Type: application/json' --data-binary "$tx" \
      "$SAFENET_RELAYER_URL"
  ) || status=000

  echo
  basename "$file" .json
  echo "  expected:   ${expected:-none (setup)}"
  echo "  safeTxHash: $safe_tx_hash"
  if [[ $status == 2?? ]]; then
    echo "  explorer:   ${explorer_url%/}/#/safeTx?chainId=$chain_id&safeTxHash=$safe_tx_hash"
  else
    echo "  error:      relayer responded with HTTP $status" >&2
    failed=$((failed + 1))
  fi
done

if (( failed )); then
  echo >&2
  die "$failed of ${#FILES[@]} proposal(s) failed"
fi
