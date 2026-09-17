# Repo-wide command runner.

set shell := ["bash", "-euo", "pipefail", "-c"]

# Use NPM to run Prettier for Markdown formatting.
prettier := "npm exec -y -- prettier@3.9.6"

# List available recipes.
default:
    @just --list

# Build every buildable package.
build:
    (cd governance/contracts && forge build --force)

# Lint/format-check every package and the repository's Markdown documentation.
check:
    (cd governance/contracts && forge fmt --check && forge lint --deny notes)
    {{prettier}} --check "**/*.md"

# Auto-fix formatting issues.
fix:
    (cd governance/contracts && forge fmt)
    {{prettier}} --write "**/*.md"

# Run every package's tests.
test:
    (cd governance/contracts && forge test -vvv)

# Deploy the Reality Veto Module. See governance/contracts/script/README.md for the operator runbook.
contracts-deploy-reality-veto *args:
    (cd governance/contracts && forge script DeployRealityVetoModuleScript {{args}})
