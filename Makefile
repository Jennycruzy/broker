# BROKER — verification entry points.
#
# `make verify` runs non-destructive unit, MCP, proof and settlement checks.
# State-changing commands simulate unless BROKER_CONFIRM=yes is supplied.

NODE ?= node
SHELL := /bin/bash

.PHONY: help verify test verify-mcp verify-settlement verify-negative probe dashboard server issue settle expire clean-caller

help:
	@echo "make verify            run all non-destructive checks"
	@echo "make test              unit tests only — no network"
	@echo "make verify-mcp        compare MCP tools with the desk and chain"
	@echo "make verify-negative   confirm tampered proofs are rejected on-chain"
	@echo "make verify-settlement reconcile the recorded settlement with chain state"
	@echo "make probe             read-only TxLINE + devnet health check"
	@echo "make server            start the BROKER x402 desk"
	@echo "make dashboard         start the demo match board"
	@echo "make issue             simulate direct policy issuance (BROKER_CONFIRM=yes sends)"
	@echo "make settle            simulate proof-gated settlement (BROKER_CONFIRM=yes sends)"
	@echo "make expire            simulate expiry (BROKER_CONFIRM=yes sends)"

# Ordered cheapest-first so a failure surfaces fast.
verify: test verify-mcp verify-negative verify-settlement
	@echo ""
	@echo "==================================================================="
	@echo " ALL CHECKS PASSED"
	@echo "==================================================================="
	@echo " x402 bind       unit tests + facilitator reconciliation"
	@echo " pricing         byte-exact against SURETY's Rust vector"
	@echo " MCP tools       agree with the desk and the chain"
	@echo " proof checks    tampered proofs rejected on-chain"
	@echo " settlement      payout reconciled with chain state"
	@echo ""
	@echo " Not covered here (they move real money, and need confirmation):"
	@echo "   make -n issue / settle / expire — see RECEIPTS.md"

test:
	@echo "--- unit tests (server: pricing, coverage, facilitator, app) ---"
	@$(NODE) --test server/*.test.mjs

verify-mcp:
	@echo ""
	@echo "--- MCP server vs desk and chain ---"
	@$(NODE) scripts/verify-mcp.mjs

verify-negative:
	@echo ""
	@echo "--- tampered proof rejection ---"
	@$(NODE) scripts/verify-proof-rejection.mjs

verify-settlement:
	@echo ""
	@echo "--- settlement reconciliation ---"
	@$(NODE) scripts/verify-settlement.mjs

probe:
	@$(NODE) scripts/probe-scores.mjs

server:
	@PORT=$${PORT:-8080} $(NODE) server/index.mjs

dashboard:
	@$(NODE) web/server.mjs

issue:
	@$(NODE) scripts/issue-policy-direct.mjs

settle:
	@$(NODE) scripts/settle-policy.mjs

expire:
	@$(NODE) scripts/expire-policy.mjs
