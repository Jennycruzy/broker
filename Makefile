# BROKER — verification entry points.
#
# `make verify` is what README.md tells a reader to run. It executes the checks
# that need no funded wallet and no operator confirmation: unit tests, the MCP
# tool surface, and the on-chain negative tests. Everything it runs either hits
# the real chain read-only or exercises real server code — nothing is stubbed.
#
# Write-side operations (issuing, settling, expiring) are deliberately NOT part
# of `verify`. They move real escrow and are gated behind GATE6_CONFIRM=yes.

NODE ?= node
SHELL := /bin/bash

.PHONY: help verify test verify-mcp verify-settlement verify-negative probe dashboard server issue settle expire clean-caller

help:
	@echo "make verify            run every non-destructive check (this is what the README means)"
	@echo "make test              unit tests only — no network"
	@echo "make verify-mcp        Gate 4: MCP tools vs the desk and the chain"
	@echo "make verify-negative   Gate 6: tampered proofs are rejected on-chain"
	@echo "make verify-settlement Gate 6: the recorded settlement, refetched from chain"
	@echo "make probe             read-only TxLINE + devnet health check"
	@echo "make server            start the BROKER x402 desk"
	@echo "make dashboard         start the demo match board"
	@echo "make issue             simulate direct policy issuance (GATE6_CONFIRM=yes sends)"
	@echo "make settle            simulate proof-gated settlement (GATE6_CONFIRM=yes sends)"
	@echo "make expire            simulate expiry (GATE6_CONFIRM=yes sends)"

# Ordered cheapest-first so a failure surfaces fast.
verify: test verify-mcp verify-negative verify-settlement
	@echo ""
	@echo "==================================================================="
	@echo " ALL CHECKS PASSED"
	@echo "==================================================================="
	@echo " Gate 1  x402 bind         unit tests + facilitator reconciliation"
	@echo " Gate 3  pricing           byte-exact against SURETY's Rust vector"
	@echo " Gate 4  MCP tools         agree with the desk and the chain"
	@echo " Gate 6  proof gate        tampered proofs rejected on-chain"
	@echo " Gate 6  settlement        payout verified from chain state"
	@echo ""
	@echo " Not covered here (they move real money, and need confirmation):"
	@echo "   make -n issue / settle / expire — see EVIDENCE.md"

test:
	@echo "--- unit tests (server: pricing, coverage, facilitator, app) ---"
	@$(NODE) --test server/*.test.mjs

verify-mcp:
	@echo ""
	@echo "--- Gate 4: MCP server vs ground truth ---"
	@$(NODE) scripts/gate4-verify.mjs

verify-negative:
	@echo ""
	@echo "--- Gate 6: tampered proofs must be rejected on-chain ---"
	@$(NODE) scripts/gate6-tamper-negative.mjs

verify-settlement:
	@echo ""
	@echo "--- Gate 6: settlement re-verified from chain state ---"
	@$(NODE) scripts/gate6-verify-settlement.mjs

probe:
	@$(NODE) scripts/gate6-probe-scores.mjs

server:
	@PORT=$${PORT:-8080} $(NODE) server/index.mjs

dashboard:
	@$(NODE) web/server.mjs

issue:
	@$(NODE) scripts/gate6-issue-policy-direct.mjs

settle:
	@$(NODE) scripts/gate6-settle-policy.mjs

expire:
	@$(NODE) scripts/gate6-expire-policy.mjs
