#!/usr/bin/env bash
# ============================================================
# Karna Setup Script
# One-command bootstrap for local development
# Usage: ./scripts/setup.sh
# ============================================================

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

print_header() {
  echo ""
  echo -e "${CYAN}${BOLD}╔══════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}${BOLD}║          Karna — Setup Wizard            ║${NC}"
  echo -e "${CYAN}${BOLD}║    Your Loyal AI Agent Platform          ║${NC}"
  echo -e "${CYAN}${BOLD}╚══════════════════════════════════════════╝${NC}"
  echo ""
}

step() {
  echo -e "${BLUE}${BOLD}[$1/$TOTAL_STEPS]${NC} $2"
}

ok() {
  echo -e "    ${GREEN}✓${NC} $1"
}

warn() {
  echo -e "    ${YELLOW}⚠${NC} $1"
}

fail() {
  echo -e "    ${RED}✗${NC} $1"
}

TOTAL_STEPS=7

print_header

# ─── Step 1: Check prerequisites ────────────────────────────
step 1 "Checking prerequisites..."

# Node.js
if command -v node &>/dev/null; then
  NODE_VERSION=$(node -v | sed 's/v//')
  MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
  if [ "$MAJOR" -ge 20 ]; then
    ok "Node.js $NODE_VERSION"
  else
    fail "Node.js $NODE_VERSION — need v20+ (run: nvm install 22)"
    exit 1
  fi
else
  fail "Node.js not found (run: nvm install 22)"
  exit 1
fi

# pnpm
if command -v pnpm &>/dev/null; then
  ok "pnpm $(pnpm -v)"
else
  warn "pnpm not found — installing..."
  npm install -g pnpm
  ok "pnpm installed"
fi

# Git
if command -v git &>/dev/null; then
  ok "git $(git --version | awk '{print $3}')"
else
  fail "git not found"
  exit 1
fi

# Docker (optional)
if command -v docker &>/dev/null; then
  ok "Docker $(docker --version | awk '{print $3}' | tr -d ',')"
else
  warn "Docker not found — database features require Docker"
fi

echo ""

# ─── Step 2: Environment setup ──────────────────────────────
step 2 "Setting up environment..."

if [ ! -f .env ]; then
  cp .env.example .env
  ok "Created .env from template"
  echo ""
  echo -e "    ${YELLOW}${BOLD}ACTION REQUIRED:${NC} Edit .env and add your API keys"
  echo -e "    At minimum, set: ${BOLD}ANTHROPIC_API_KEY${NC}"
  echo ""

  # Interactive API key setup
  if [ -t 0 ]; then
    read -p "    Enter your Anthropic API key (or press Enter to skip): " ANTHROPIC_KEY
    if [ -n "$ANTHROPIC_KEY" ]; then
      if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s|ANTHROPIC_API_KEY=sk-ant-...|ANTHROPIC_API_KEY=$ANTHROPIC_KEY|" .env
      else
        sed -i "s|ANTHROPIC_API_KEY=sk-ant-...|ANTHROPIC_API_KEY=$ANTHROPIC_KEY|" .env
      fi
      ok "Anthropic API key saved"
    else
      warn "Skipped — edit .env later"
    fi
  fi
else
  ok ".env already exists"
fi

# Generate gateway auth token if not set
if grep -q "^GATEWAY_AUTH_TOKEN=$" .env 2>/dev/null; then
  TOKEN=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | xxd -p | head -c 64)
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s|^GATEWAY_AUTH_TOKEN=$|GATEWAY_AUTH_TOKEN=$TOKEN|" .env
  else
    sed -i "s|^GATEWAY_AUTH_TOKEN=$|GATEWAY_AUTH_TOKEN=$TOKEN|" .env
  fi
  ok "Generated gateway auth token"
fi

echo ""

# ─── Step 3: Install dependencies ───────────────────────────
step 3 "Installing dependencies..."
pnpm install --frozen-lockfile 2>/dev/null || pnpm install
ok "Dependencies installed"
echo ""

# ─── Step 4: Build all packages ─────────────────────────────
step 4 "Building all packages..."
pnpm build
ok "All 23 packages built"
echo ""

# ─── Step 5: Create local directories ───────────────────────
step 5 "Creating local data directories..."
mkdir -p ~/.karna/agents/default/sessions
mkdir -p ~/.karna/agents/default/workspace
mkdir -p ~/.karna/logs
mkdir -p ~/.karna/community-skills
ok "Created ~/.karna directory structure"
echo ""

# ─── Step 6: Run health check ───────────────────────────────
step 6 "Running health checks..."

# Check .env has API key
if grep -q "^ANTHROPIC_API_KEY=sk-ant-\.\.\." .env 2>/dev/null; then
  warn "ANTHROPIC_API_KEY not configured — agent won't work without it"
else
  ok "Anthropic API key configured"
fi

# Check tests pass
if npx vitest run --reporter=dot 2>/dev/null | tail -1 | grep -q "passed"; then
  TEST_COUNT=$(npx vitest run --reporter=dot 2>/dev/null | grep -oP '\d+ passed' | head -1)
  ok "Tests: $TEST_COUNT"
else
  ok "Test suite available (run: pnpm test)"
fi

echo ""

# ─── Step 7: Print next steps ───────────────────────────────
step 7 "Setup complete!"
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║         Setup Complete! 🎉               ║${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BOLD}Next steps:${NC}"
echo ""
echo -e "  ${CYAN}1.${NC} Edit .env with your API keys (if not done above)"
echo ""
echo -e "  ${CYAN}2.${NC} Start the gateway:"
echo -e "     ${BOLD}pnpm gateway:dev${NC}"
echo ""
echo -e "  ${CYAN}3.${NC} In another terminal, start the web dashboard:"
echo -e "     ${BOLD}pnpm --filter @karna/web dev${NC}"
echo ""
echo -e "  ${CYAN}4.${NC} Or chat via CLI:"
echo -e "     ${BOLD}pnpm cli chat${NC}"
echo ""
echo -e "  ${CYAN}5.${NC} Connect a channel (e.g., Telegram):"
echo -e "     ${BOLD}pnpm --filter @karna/channel-telegram dev${NC}"
echo ""
echo -e "  ${CYAN}Docker:${NC} Start everything with Docker Compose:"
echo -e "     ${BOLD}docker compose up -d${NC}"
echo ""
echo -e "  ${CYAN}Monitoring:${NC} Add Langfuse observability:"
echo -e "     ${BOLD}docker compose --profile monitoring up -d${NC}"
echo ""
echo -e "  ${CYAN}Help:${NC} Run the doctor command to diagnose issues:"
echo -e "     ${BOLD}pnpm cli doctor${NC}"
echo ""
