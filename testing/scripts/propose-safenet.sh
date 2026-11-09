#!/usr/bin/env bash
#
# propose-safenet.sh PATH...
#
# Proposes test transactions directly to Safenet, through the relayer's
# full-transaction endpoint (SAFENET_RELAYER_URL), for the Safe under test.
# PATH is a test transaction file or a directory of them. Every transaction is
# proposed on CHAIN_ID, for SAFE_ADDRESS on that chain, with the nonce and
# owners of the Safe on that chain (see safe_info) and the test token of that
# chain (see token_address). For each file, prints the case, its note and the
# Safenet explorer link of the proposed transaction, where the Sentinel votes
# can be compared with the note.
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
chain_id=$(chain_id)
token=$(token_address "$chain_id")

collect_files "$@"

info=$(safe_info "$chain_id")
echo "Proposing ${#FILES[@]} transaction(s) for Safe $SAFE_ADDRESS on chain $chain_id to $SAFENET_RELAYER_URL"
echo "Safe nonce: $(jq -r .nonce <<<"$info")"
echo "Test token: ${token:-none (set TOKEN_ADDRESS)}"

failed=0
for file in "${FILES[@]}"; do
  tx=$(load_safe_tx "$file" "$chain_id" "$info" "$token")
  safe_tx_hash=$(safe_tx_hash "$tx")

  status=$(
    curl -sS -o /dev/null -w '%{http_code}' -X POST \
      -H 'Content-Type: application/json' --data-binary "$tx" \
      "$SAFENET_RELAYER_URL"
  ) || status=000

  echo
  basename "$file" .json
  jq -r '.metadata | "  note:       \(.note)", (.reference // empty | "  reference:  \(.)")' "$file"
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
