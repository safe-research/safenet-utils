#!/usr/bin/env bash
#
# create-cow-order.sh CHAIN_ID
#
# Creates a CoW Swap order for the Safe under test (SAFE_ADDRESS) on CHAIN_ID in
# the CoW Protocol orderbook: a fixed stablecoin swap of 0.01 EURC for at least
# 0.0099 EURe, with the Safe as the receiver. The order uses pre-signing, so it
# only becomes valid once the Safe calls GPv2Settlement.setPreSignature.
#
# Creates or overwrites transactions/<CHAIN_ID>/allowed/cow-swap-trade.json
# with the Safe transaction that does this: a batch, through MultiSendCallOnly,
# of an approval of exactly the order's sell amount to the GPv2VaultRelayer and
# the pre-signature of the order. The file is a test transaction file like any
# other, but its order UID contains SAFE_ADDRESS and expires, so it is
# git-ignored and must be recreated right before proposing the allowed set.
#
# All order parameters are fixed and the order is valid until the end of the
# next full hour, so the order, and with it the file, is the same for every run
# within the same hour. An order that already exists is reused.

set -euo pipefail

# shellcheck source=../lib/common.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/../lib/common.sh"

COW_API_URL=https://api.cow.fi
COW_EXPLORER_URL=https://explorer.cow.fi

# The CoW Protocol contracts, at the same address on every supported chain.
GPV2_SETTLEMENT=0x9008D19f58AAbD9eD0D60971565AA8510560ab41
GPV2_VAULT_RELAYER=0xC92E8bdf79f0507f65a392b0ab4667716BFE0110
# The canonical MultiSendCallOnly v1.4.1, as used by the other batches.
MULTI_SEND_CALL_ONLY=0x9641d764fc13c8B624c04430C7356C1C7C8102e2

# Identifies the orders created by this script in the CoW Protocol app data.
APP_DATA='{"appCode":"safenet-utils","metadata":{},"version":"1.3.0"}'

# 0.01 EURC (6 decimals) for at least 0.0099 EURe (18 decimals).
SELL_AMOUNT=10000
BUY_AMOUNT=9900000000000000

# keccak256("Order(address sellToken,address buyToken,address receiver,uint256 sellAmount,uint256 buyAmount,uint32 validTo,bytes32 appData,uint256 feeAmount,string kind,bool partiallyFillable,string sellTokenBalance,string buyTokenBalance)")
ORDER_TYPEHASH=0xd5a25ba2e97094ad7d83dc28a6572da797d6b3e7fc6663bd93efb789fc17e489
# keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
COW_DOMAIN_TYPEHASH=0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f

(( $# == 1 )) || die "usage: create-cow-order.sh CHAIN_ID"
chain_id=$1

load_dotenv
require_env SAFE_ADDRESS
[[ $SAFE_ADDRESS =~ ^0x[0-9a-fA-F]{40}$ ]] \
  || die "SAFE_ADDRESS is not an address: \"$SAFE_ADDRESS\""

# EURC is Circle's EURC (bridged as EURC.e on Gnosis Chain), EURe is Monerium's
# EURe. There is no EURC on Arbitrum One.
case $chain_id in
  1)
    network=mainnet explorer_url=$COW_EXPLORER_URL
    sell_token=0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c buy_token=0x39b8B6385416f4cA36a20319F70D28621895279D
    ;;
  100)
    network=xdai explorer_url=$COW_EXPLORER_URL/gc
    sell_token=0x54E4cB2a4Fa0ee46E3d9A98D13Bea119666E09f6 buy_token=0x420CA0f9B9b604cE0fd9C18EF134C705e5Fa3430
    ;;
  *) die "no CoW Swap test trade for chain ID \"$chain_id\" (expected 1 or 100)" ;;
esac

# The end of the next full hour: between one and two hours from now, and the
# same for every run within the current hour.
valid_to=$(( ($(date +%s) / 3600 + 2) * 3600 ))
valid_until=$(jq -nr --argjson valid_to "$valid_to" '$valid_to | todate')

# The order UID is the EIP-712 hash of the order, followed by its owner and
# validTo. It is computed locally, so that an order that already exists can be
# reused.
domain_separator=$(
  cast keccak "$(
    cast abi-encode 'f(bytes32,bytes32,bytes32,uint256,address)' \
      "$COW_DOMAIN_TYPEHASH" "$(cast keccak 'Gnosis Protocol')" "$(cast keccak v2)" \
      "$chain_id" "$GPV2_SETTLEMENT"
  )"
)
order_hash=$(
  cast keccak "$(
    cast abi-encode 'f(bytes32,address,address,address,uint256,uint256,uint32,bytes32,uint256,bytes32,bool,bytes32,bytes32)' \
      "$ORDER_TYPEHASH" "$sell_token" "$buy_token" "$SAFE_ADDRESS" "$SELL_AMOUNT" "$BUY_AMOUNT" \
      "$valid_to" "$(cast keccak "$APP_DATA")" 0 "$(cast keccak sell)" false \
      "$(cast keccak erc20)" "$(cast keccak erc20)"
  )"
)
uid=$(
  cast concat-hex \
    "$(cast keccak "$(cast concat-hex 0x1901 "$domain_separator" "$order_hash")")" \
    "$SAFE_ADDRESS" "$(printf '0x%08x' "$valid_to")"
)
uid=${uid,,}

# A limit order without a fee, so no quote is needed. For pre-signed orders, the
# signature is the owner's address.
order=$(
  jq -nc \
    --arg sell_token "$sell_token" \
    --arg buy_token "$buy_token" \
    --arg sell_amount "$SELL_AMOUNT" \
    --arg buy_amount "$BUY_AMOUNT" \
    --arg safe "$SAFE_ADDRESS" \
    --arg app_data "$APP_DATA" \
    --argjson valid_to "$valid_to" '
    {
      sellToken: $sell_token,
      buyToken: $buy_token,
      receiver: $safe,
      sellAmount: $sell_amount,
      buyAmount: $buy_amount,
      validTo: $valid_to,
      appData: $app_data,
      feeAmount: "0",
      kind: "sell",
      partiallyFillable: false,
      sellTokenBalance: "erc20",
      buyTokenBalance: "erc20",
      signingScheme: "presign",
      signature: $safe,
      from: $safe
    }
  '
)
response=$(
  curl -sS -w '\n%{http_code}' -X POST -H 'Content-Type: application/json' --data-binary "$order" \
    "$COW_API_URL/$network/api/v1/orders"
) || die "failed to create the CoW Swap order on chain $chain_id"
status=${response##*$'\n'}
response=${response%$'\n'*}
if [[ $status == 201 ]]; then
  [[ $(jq -r . <<<"$response") == "$uid" ]] \
    || die "the CoW Protocol API created order $response, but expected $uid"
  result=created
elif [[ $status == 400 && $(jq -r '.errorType? // empty' <<<"$response" 2>/dev/null) == DuplicatedOrder ]]; then
  result=reused
else
  die "failed to create the CoW Swap order on chain $chain_id: HTTP $status $response"
fi

# A MultiSend transaction is packed as operation (uint8, CALL), to, value and
# the length of data, followed by data.
multi_send_tx() {
  local to=$1 data=$2
  cast abi-encode --packed 'f(uint8,address,uint256,uint256,bytes)' \
    0 "$to" 0 $(( (${#data} - 2) / 2 )) "$data"
}
approve=$(cast calldata 'approve(address,uint256)' "$GPV2_VAULT_RELAYER" "$SELL_AMOUNT")
pre_sign=$(cast calldata 'setPreSignature(bytes,bool)' "$uid" true)
data=$(
  cast calldata 'multiSend(bytes)' "$(
    cast concat-hex \
      "$(multi_send_tx "$sell_token" "$approve")" \
      "$(multi_send_tx "$GPV2_SETTLEMENT" "$pre_sign")"
  )"
)

file=$TESTING_ROOT/transactions/$chain_id/allowed/cow-swap-trade.json
mkdir -p -- "$(dirname -- "$file")"
jq -n \
  --arg chain_id "$(cast to-hex "$chain_id")" \
  --arg safe "$(cast to-check-sum-address "0x$PLACEHOLDER_SAFE")" \
  --arg to "$MULTI_SEND_CALL_ONLY" \
  --arg data "$data" \
  --arg note "Pre-signs CoW Swap order $uid, which sells 0.01 EURC ($sell_token) for at least 0.0099 EURe ($buy_token), with the Safe as the receiver, valid until $valid_until. Batches approve($GPV2_VAULT_RELAYER, $SELL_AMOUNT), exactly the order's sell amount to the GPv2VaultRelayer, so that R-4.5 does not apply, and GPv2Settlement.setPreSignature(orderUid, true). The batch is a DELEGATECALL to MultiSendCallOnly v1.4.1, which writes no Safe storage (R-4.2). The order was created for the Safe under test: its UID contains the Safe's address and validTo." '
  {
    request: {
      transaction: {
        chainId: $chain_id,
        safe: $safe,
        to: $to,
        value: "0x0",
        data: $data,
        operation: 1,
        safeTxGas: "0x0",
        baseGas: "0x0",
        gasPrice: "0x0",
        gasToken: "0x0000000000000000000000000000000000000000",
        refundReceiver: "0x0000000000000000000000000000000000000000",
        nonce: "0x0"
      }
    },
    response: {verdict: "secure"},
    metadata: {note: $note}
  }
' >"$file"

echo "CoW Swap order for Safe $SAFE_ADDRESS on chain $chain_id ($result)"
echo "  file:     testing/${file#"$TESTING_ROOT/"}"
echo "  order:    $explorer_url/orders/$uid"
echo "  validTo:  $valid_until"
