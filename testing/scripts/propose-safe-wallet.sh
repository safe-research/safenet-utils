#!/usr/bin/env bash
#
# propose-safe-wallet.sh PATH...
#
# Proposes test transactions to the Safe{Wallet} interface, through the Safe
# Transaction Service, for the Safe under test. PATH is a test transaction file
# or a directory of them. Every transaction is proposed on CHAIN_ID, for
# SAFE_ADDRESS on that chain, with the nonce and owners of the Safe on that
# chain (see safe_info) and the test token of that chain (see token_address),
# and shows up in the Safe{Wallet} queue. For each file, prints the case, its
# note, the safeTxHash and the Safe{Wallet} link of the proposed transaction.
#
# The proposal is signed by PROPOSER_PRIVATE_KEY, which must be a proposer
# (delegate) or an owner of the Safe. A proposer's signature does not count as
# a confirmation, an owner's does.

set -euo pipefail

# shellcheck source=../lib/common.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/../lib/common.sh"

SAFE_WALLET_URL=https://app.safe.global

(( $# )) || die "usage: propose-safe-wallet.sh PATH..."

load_dotenv
require_env SAFE_ADDRESS PROPOSER_PRIVATE_KEY
chain_id=$(chain_id)
network=$(tx_service_network "$chain_id")
token=$(token_address "$chain_id")

# The API key, if any, is passed on stdin so that it does not show up in the
# process list.
auth=()
[[ -z ${SAFE_API_KEY:-} ]] || auth=(-H @-)

sender=$(cast wallet address --private-key "$PROPOSER_PRIVATE_KEY") \
  || die "PROPOSER_PRIVATE_KEY is not a private key"

collect_files "$@"

info=$(safe_info "$chain_id")
echo "Proposing ${#FILES[@]} transaction(s) for Safe $SAFE_ADDRESS on chain $chain_id to Safe{Wallet}, as $sender"
echo "Safe nonce: $(jq -r .nonce <<<"$info")"
echo "Test token: ${token:-none (set TOKEN_ADDRESS)}"

failed=0
for file in "${FILES[@]}"; do
  case_name=$(basename "$file" .json)
  tx=$(load_safe_tx "$file" "$chain_id" "$info" "$token")
  safe_tx_hash=$(safe_tx_hash "$tx")
  signature=$(cast wallet sign --no-hash --private-key "$PROPOSER_PRIVATE_KEY" "$safe_tx_hash")

  # The service takes checksummed addresses, quantities as decimal integers
  # (sent as strings, so that they are not limited to the precision of a JSON
  # number), and empty data as null. The origin names the case in the
  # Safe{Wallet} queue.
  body=$(
    jq -c \
      --arg hash "$safe_tx_hash" \
      --arg sender "$sender" \
      --arg signature "$signature" \
      --arg origin "safenet-utils test: $case_name" \
      --arg safe "$(cast to-check-sum-address "$(jq -r .safe <<<"$tx")")" \
      --arg to "$(cast to-check-sum-address "$(jq -r .to <<<"$tx")")" \
      --arg gas_token "$(cast to-check-sum-address "$(jq -r .gasToken <<<"$tx")")" \
      --arg refund_receiver "$(cast to-check-sum-address "$(jq -r .refundReceiver <<<"$tx")")" \
      --arg value "$(cast to-dec "$(jq -r .value <<<"$tx")")" \
      --arg safe_tx_gas "$(cast to-dec "$(jq -r .safeTxGas <<<"$tx")")" \
      --arg base_gas "$(cast to-dec "$(jq -r .baseGas <<<"$tx")")" \
      --arg gas_price "$(cast to-dec "$(jq -r .gasPrice <<<"$tx")")" '
      {
        safe: $safe,
        to: $to,
        value: $value,
        data: (if .data == "0x" then null else .data end),
        operation,
        safeTxGas: $safe_tx_gas,
        baseGas: $base_gas,
        gasPrice: $gas_price,
        gasToken: $gas_token,
        refundReceiver: $refund_receiver,
        nonce,
        contractTransactionHash: $hash,
        sender: $sender,
        signature: $signature,
        origin: ({name: $origin} | tojson)
      }
    ' <<<"$tx"
  )

  response=$(
    curl -sS -w '\n%{http_code}' -X POST "${auth[@]}" \
      -H 'Content-Type: application/json' --data-binary "$body" \
      "$SAFE_TX_SERVICE_URL/$network/api/v2/safes/$SAFE_ADDRESS/multisig-transactions/" \
      <<<"Authorization: Bearer ${SAFE_API_KEY:-}"
  ) || response=$'\n000'
  status=${response##*$'\n'}
  response=${response%$'\n'*}

  echo
  echo "$case_name"
  jq -r '.metadata | "  note:       \(.note)", (.reference // empty | "  reference:  \(.)")' "$file"
  echo "  safeTxHash: $safe_tx_hash"
  if [[ $status == 2?? ]]; then
    echo "  safe:       $SAFE_WALLET_URL/transactions/tx?safe=$network:$SAFE_ADDRESS&id=multisig_${SAFE_ADDRESS}_$safe_tx_hash"
  else
    echo "  error:      Safe Transaction Service responded with HTTP $status ${response}" >&2
    failed=$((failed + 1))
  fi
done

if (( failed )); then
  echo >&2
  die "$failed of ${#FILES[@]} proposal(s) failed"
fi
