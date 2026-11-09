# Repo-wide command runner.

set shell := ["bash", "-euo", "pipefail", "-c"]

# Use NPM to run Prettier for Markdown formatting.
prettier := "npm exec -y -- prettier@3.9.6"

# List available recipes.
default:
    @just --list

# Install every npm package's dependencies.
deps:
    npm --prefix governance/apps/safenet-arbitration ci

# Build every buildable package.
build:
    (cd governance/contracts && forge build --force)
    npm --prefix governance/apps/safenet-arbitration run build

# Lint/format-check every package and the repository's Markdown documentation.
check:
    (cd governance/contracts && forge fmt --check && forge lint --deny notes)
    npm --prefix governance/apps/safenet-arbitration run check
    shellcheck -x testing/*/*.sh
    {{prettier}} --check "**/*.md"

# Auto-fix formatting issues.
fix:
    (cd governance/contracts && forge fmt)
    npm --prefix governance/apps/safenet-arbitration run fix
    {{prettier}} --write "**/*.md"

# Run every package's tests.
test:
    (cd governance/contracts && forge test -vvv)
    npm --prefix governance/apps/safenet-arbitration run test

# Deploy the Reality Veto Module. See governance/contracts/script/README.md for the operator runbook.
contracts-deploy-reality-veto *args:
    (cd governance/contracts && forge script DeployRealityVetoModuleScript {{args}})

# Run the arbitration Safe App's Vite dev server. See governance/apps/safenet-arbitration/README.md.
safenet-arbitration-app-dev:
    npm --prefix governance/apps/safenet-arbitration run dev

# Propose test transactions (default: all templates) directly to Safenet. -c/--chain and -s/--safe override CHAIN_ID and SAFE_ADDRESS. See testing/README.md.
[arg("chain_id", long="chain", short="c")]
[arg("safe_address", long="safe", short="s")]
testing-propose-safenet chain_id=env("CHAIN_ID", "") safe_address=env("SAFE_ADDRESS", "") *paths="testing/transactions/templates":
    CHAIN_ID={{quote(chain_id)}} SAFE_ADDRESS={{quote(safe_address)}} testing/scripts/propose-safenet.sh {{paths}}

# Create a CoW Swap order and its pre-sign test transaction. -c/--chain and -s/--safe override CHAIN_ID and SAFE_ADDRESS. See testing/README.md.
[arg("chain_id", long="chain", short="c")]
[arg("safe_address", long="safe", short="s")]
testing-cow-order chain_id=env("CHAIN_ID", "") safe_address=env("SAFE_ADDRESS", ""):
    CHAIN_ID={{quote(chain_id)}} SAFE_ADDRESS={{quote(safe_address)}} testing/scripts/create-cow-order.sh
