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
