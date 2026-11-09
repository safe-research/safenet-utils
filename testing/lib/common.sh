# shellcheck shell=bash
#
# lib/common.sh — helpers shared by the testing scripts.
#
# Sourced, never executed. The caller is expected to have run
# `set -euo pipefail`.

TESTING_ROOT="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

SAFE_TX_SERVICE_URL=https://api.safe.global/tx-service

# The placeholders used by test transaction templates, replaced by load_safe_tx.
# Lowercase and without the 0x prefix, which is how they appear in ABI-encoded
# calldata.
PLACEHOLDER_SAFE=5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe
PLACEHOLDER_RECEIVER_A=a11cea11cea11cea11cea11cea11cea11cea11ce
PLACEHOLDER_RECEIVER_B=b0bb0b0bb0b0bb0b0bb0b0bb0b0bb0b0bb0b0bb0
PLACEHOLDER_TOKEN=70ce70ce70ce70ce70ce70ce70ce70ce70ce70ce

# keccak256("EIP712Domain(uint256 chainId,address verifyingContract)"), the
# domain used by Safe >= 1.3.0.
DOMAIN_SEPARATOR_TYPEHASH=0x47e79534a245952e8b16893a336b85a3d9ea9fa8c573f3d803afb92a79469218
# keccak256("SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)")
SAFE_TX_TYPEHASH=0xbb8310d486368db6bd6f849402fdd73ad53d316b5a4b2644ad6efe0f941286d8

# die MESSAGE...
die() {
  echo "error: $*" >&2
  exit 1
}

# load_dotenv
#
# Exports the variables set in testing/.env, if that file exists. Variables
# that are already set (and non-empty) in the environment take precedence over
# the file, so that a single run can override it.
load_dotenv() {
  local file="$TESTING_ROOT/.env" entry name
  [[ -f $file ]] || return 0
  # The file is sourced in an empty environment, so that only its own variables
  # are printed. "$1" is expanded by that shell, not by this one.
  # shellcheck disable=SC2016
  while IFS= read -r -d '' entry; do
    name=${entry%%=*}
    [[ -n ${!name:-} ]] || export "${entry?}"
  done < <(env -i bash -c 'set -a; source "$1"; env -0' _ "$file")
}

# require_env NAME...
#
# Fails, naming every missing variable at once, unless all of them are set and
# non-empty.
require_env() {
  local -a missing=()
  local name

  for name in "$@"; do
    [[ -n ${!name:-} ]] || missing+=("$name")
  done

  if (( ${#missing[@]} )); then
    die "missing environment variable(s): ${missing[*]} (see testing/.env.sample)"
  fi
}

# collect_files PATH...
#
# Populates the FILES array with test transaction files: a file is taken as is,
# a directory is expanded to every *.json file below it, sorted. A path that
# does not exist, or a directory without any files, is an error.
collect_files() {
  local -a found=()
  local path

  # FILES is the output of this function, read by the sourcing script.
  # shellcheck disable=SC2034
  FILES=()

  for path in "$@"; do
    if [[ -d $path ]]; then
      mapfile -t found < <(find "$path" -type f -name '*.json' | LC_ALL=C sort)
      (( ${#found[@]} )) || die "no test transaction files in \"$path\""
      FILES+=("${found[@]}")
    elif [[ -f $path ]]; then
      FILES+=("$path")
    else
      die "no such file or directory: \"$path\""
    fi
  done
}

# chain_id
#
# Prints CHAIN_ID, the decimal chain ID that the test transactions are proposed
# on. Fails unless it is set.
chain_id() {
  require_env CHAIN_ID
  # CHAIN_ID is set by the environment, not by the scripts.
  # shellcheck disable=SC2153
  [[ $CHAIN_ID =~ ^[1-9][0-9]*$ ]] || die "CHAIN_ID is not a decimal chain ID: \"$CHAIN_ID\""
  printf '%s\n' "$CHAIN_ID"
}

# token_address CHAIN_ID
#
# Prints the test token that replaces the token placeholder: TOKEN_ADDRESS if
# set, and otherwise the canonical USDC deployment of a network of the Charter.
# Prints nothing for any other chain without TOKEN_ADDRESS.
token_address() {
  if [[ -n ${TOKEN_ADDRESS:-} ]]; then
    [[ $TOKEN_ADDRESS =~ ^0x[0-9a-fA-F]{40}$ ]] \
      || die "TOKEN_ADDRESS is not an address: \"$TOKEN_ADDRESS\""
    printf '%s\n' "$TOKEN_ADDRESS"
    return
  fi
  case $1 in
    1) echo 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 ;;
    100) echo 0x2a22f9c3b484c3629090FeED35F17Ff8F88f76F0 ;;
    42161) echo 0xaf88d065e77c8cC2239327C5EDb3A432268e5831 ;;
  esac
}

# tx_service_network CHAIN_ID
#
# Prints the Safe Transaction Service network name of a chain with test
# transactions: the networks of the Charter, and Optimism for the
# unsupported-network case.
tx_service_network() {
  case $1 in
    1) echo eth ;;
    10) echo oeth ;;
    100) echo gno ;;
    42161) echo arb1 ;;
    *) die "no Safe Transaction Service network for chain ID \"$1\" (expected 1, 10, 100 or 42161)" ;;
  esac
}

# safe_info CHAIN_ID
#
# Prints {"address", "nonce", "owners"} of SAFE_ADDRESS on CHAIN_ID, with the
# nonce as a decimal string. The nonce and owners are taken from the chain's
# entry in SAFE_INFO (JSON keyed by chain ID), if there is one, and are read
# from the Safe Transaction Service otherwise (with SAFE_API_KEY, if set;
# without it, the service is rate limited). Fails if the Safe has fewer than 2
# owners, because its first two owners are the receivers of the test
# transactions.
safe_info() {
  local chain_id=$1
  require_env SAFE_ADDRESS

  [[ $SAFE_ADDRESS =~ ^0x[0-9a-fA-F]{40}$ ]] \
    || die "SAFE_ADDRESS is not an address: \"$SAFE_ADDRESS\""

  local network response info="" owners
  local -a auth=()

  if [[ -n ${SAFE_INFO:-} ]]; then
    info=$(
      jq -c --arg chain "$chain_id" --arg address "$SAFE_ADDRESS" '
        .[$chain] // empty
        | {address: $address, nonce: (.nonce | tostring), owners}
      ' <<<"$SAFE_INFO"
    ) || die "failed to parse SAFE_INFO as JSON"
    if [[ -n $info ]]; then
      jq -e '
        (.nonce | test("^[0-9]+$"))
        and (.owners | type == "array" and all(type == "string" and test("^0x[0-9a-fA-F]{40}$")))
      ' <<<"$info" >/dev/null \
        || die "invalid entry for chain $chain_id in SAFE_INFO (expected a decimal \"nonce\" and an array of \"owners\" addresses)"
    fi
  fi

  if [[ -z $info ]]; then
    network=$(tx_service_network "$chain_id") || exit 1

    # The API key, if any, is passed on stdin so that it does not show up in the
    # process list.
    [[ -z ${SAFE_API_KEY:-} ]] || auth=(-H @-)
    response=$(
      curl -fsS "${auth[@]}" "$SAFE_TX_SERVICE_URL/$network/api/v1/safes/$SAFE_ADDRESS/" \
        <<<"Authorization: Bearer ${SAFE_API_KEY:-}"
    ) || die "failed to read Safe $SAFE_ADDRESS on chain $chain_id from the Safe Transaction Service ($network); set its nonce and owners in SAFE_INFO instead (see testing/.env.sample)"
    info=$(jq -c '{address, nonce: (.nonce | tostring), owners}' <<<"$response")
  fi

  owners=$(jq '.owners | length' <<<"$info")
  (( owners >= 2 )) \
    || die "Safe $SAFE_ADDRESS on chain $chain_id has $owners owner(s), but the test transactions need 2 (its first two owners are the receivers)"

  printf '%s\n' "$info"
}

# load_safe_tx FILE CHAIN_ID INFO TOKEN
#
# Prints the Safe transaction of a test transaction file, ready to be hashed and
# proposed: the placeholders are replaced with the Safe and its first two owners
# from INFO (as printed by safe_info) and with TOKEN (as printed by
# token_address), the chain ID is CHAIN_ID (as a hex quantity) and the nonce
# is the Safe's nonce (a decimal string). All other fields are kept as written.
# Fails if the file uses the token placeholder and TOKEN is empty, or if the
# file sets a chain ID other than CHAIN_ID, as generated files do.
load_safe_tx() {
  local file=$1 chain_id=$2 info=$3 token=$4 chain_id_hex
  chain_id_hex=$(cast to-hex "$chain_id")

  if [[ -z $token ]] && grep -qi -- "$PLACEHOLDER_TOKEN" "$file"; then
    die "$file uses the test token, but there is no default token for chain $chain_id; set TOKEN_ADDRESS"
  fi

  # The placeholders are replaced in the raw file text, case-insensitively, with
  # lowercase addresses, so that they are replaced in every field, including
  # the ABI-encoded calldata.
  jq -cRs \
    --arg safe "$PLACEHOLDER_SAFE" \
    --arg receiver_a "$PLACEHOLDER_RECEIVER_A" \
    --arg receiver_b "$PLACEHOLDER_RECEIVER_B" \
    --arg token_placeholder "$PLACEHOLDER_TOKEN" \
    --arg token "$token" \
    --arg chain_id "$chain_id_hex" \
    --argjson info "$info" '
    def bare: ltrimstr("0x") | ascii_downcase;
    gsub($safe; $info.address | bare; "i")
    | gsub($receiver_a; $info.owners[0] | bare; "i")
    | gsub($receiver_b; $info.owners[1] | bare; "i")
    | if $token == "" then . else gsub($token_placeholder; $token | bare; "i") end
    | fromjson
    | .transaction
    | if has("chainId") and (.chainId | ascii_downcase) != $chain_id then
        error("set for chain ID \(.chainId), not for CHAIN_ID \($chain_id)")
      else . end
    | {
        chainId: $chain_id,
        safe, to, value, data, operation, safeTxGas, baseGas, gasPrice,
        gasToken, refundReceiver,
        nonce: $info.nonce
      }
  ' -- "$file" || die "failed to load $file"
}

# safe_tx_hash SAFE_TX
#
# Prints the EIP-712 SafeTx hash of a Safe transaction (as printed by
# load_safe_tx; quantities may be hex or decimal), as computed by Safe >= 1.3.0.
safe_tx_hash() {
  local -a fields
  local domain_separator data_hash struct_hash

  mapfile -t fields < <(
    jq -r '.chainId, .safe, .to, .value, .data, .operation, .safeTxGas, .baseGas, .gasPrice, .gasToken, .refundReceiver, .nonce' <<<"$1"
  )

  domain_separator=$(
    cast keccak "$(cast abi-encode 'f(bytes32,uint256,address)' "$DOMAIN_SEPARATOR_TYPEHASH" "${fields[@]:0:2}")"
  )
  data_hash=$(cast keccak "${fields[4]}")
  struct_hash=$(
    cast keccak "$(
      cast abi-encode 'f(bytes32,address,uint256,bytes32,uint8,uint256,uint256,uint256,address,address,uint256)' \
        "$SAFE_TX_TYPEHASH" "${fields[2]}" "${fields[3]}" "$data_hash" "${fields[@]:5}"
    )"
  )
  cast keccak "$(cast concat-hex 0x1901 "$domain_separator" "$struct_hash")"
}
