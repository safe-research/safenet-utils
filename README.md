# Safenet Utils

Periphery tooling for [Safenet](https://github.com/safe-research/safenet) — governance contracts and deployment
scripts that build on Safenet but live outside its core protocol (e.g. veto/guardian modules), plus examples and CI
helpers.

This repo is being built up incrementally; packages are added as they're needed rather than scaffolded upfront.
Expect (non-exhaustive, added over time):

- **Contracts** — Governance/periphery contracts and deployment scripts (Solidity & Foundry)
- **Examples** — Scripts for interacting with Safenet-secured Safes (TypeScript & npm)

## Developing

### Requirements

- [NPM](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm), used to run Prettier for Markdown
  formatting
- [Just](https://github.com/casey/just), the command runner used to invoke every command below

### Just Commands

All repo-wide commands are exposed as recipes in the root [Justfile](./Justfile) — run `just --list` for the full
set.

## Planning Epics

When developing larger epics spanning over multiple PRs with an agent (for example a complex feature or big
refactor), generate a plan to help guide the agent by outlining the separate phases in the development. It is
recommended to use the `/plan-epic` feature from <https://github.com/safe-research/agents> for this.
