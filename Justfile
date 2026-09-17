# Repo-wide command runner.

set shell := ["bash", "-euo", "pipefail", "-c"]

# Use NPM to run Prettier for Markdown formatting.
prettier := "npm exec -y -- prettier@3.9.6"

# List available recipes.
default:
    @just --list

# Lint/format-check the repository's Markdown documentation.
check:
    {{prettier}} --check "**/*.md"

# Auto-fix formatting issues.
fix:
    {{prettier}} --write "**/*.md"
