# Safenet Utils Developer Guide

Safenet Utils is a periphery repo for [Safenet](https://github.com/safe-research/safenet): governance tooling
(contracts and deployment scripts) that builds on Safenet but lives outside its core protocol, plus examples and CI
helpers. It is deliberately separate from the `safenet` repo itself so periphery code can iterate without touching
the core protocol's release cadence.

## Architecture

The repo is being built up incrementally — packages (e.g. `governance/contracts/` for Solidity/Foundry,
`examples/` for TypeScript scripts) are scaffolded as they're needed rather than upfront. When adding a new
package:

- Wire its build/lint/test commands into the root [Justfile](./Justfile) as recipes.
- If it references Safenet's own contracts/interfaces, prefer depending on
  [safenet](https://github.com/safe-research/safenet) (e.g. as a git submodule) over duplicating them.
- Update this file's Architecture section and the root [README.md](./README.md) to describe it.

## Coding Guidelines

Code SHOULD focus on security and maintainability. Existing code and components SHOULD be reused. Refer to existing
code (in this repo and in [safenet](https://github.com/safe-research/safenet)) to determine coding style and which
implementation to choose.

You MUST format, lint and test before committing — run `just check`/`just fix`, plus any package-specific test
command, before committing.

## Testing Guidelines

New code SHOULD generally be tested. Design tests that do not require a high amount of churn with refactors (such
as testing general behaviours and not implementation details).

## Development Commands

Make sure you have [Just](https://github.com/casey/just) installed. All repo-wide commands are exposed as recipes
in the root [Justfile](./Justfile) — run `just --list` for the full set.

## Code Quality Tools

Run `just check` before committing. Run `just fix` to auto-correct formatting issues.

## Git Branch Naming Convention

Branch names must follow the pattern `pr/<description>` where:

- `<description>` is kebab-case and meaningfully describes the specific change being made

### Good examples

- `pr/add-veto-module`
- `pr/fix-deploy-script-nonce-handling`

### Bad examples

- `dev`
- `wip`
- `my-branch`
- `feat/wip`
- `fix/stuff`
