#!/usr/bin/env bash
# One-time bootstrap for running Faculty Atlas's daily-update.sh on a Jetson
# Orin Nano (JetPack 6 / Ubuntu 22.04 arm64, 8GB). Review each section before
# running — this touches system packages and installs a systemd timer.
#
# Assumes:
#   - The repo is already cloned at $REPO_DIR (via an SSH deploy key with
#     write access — see the SSH section below if you haven't set that up).
#   - You're running this as the user that will own the systemd service.
#
# Usage: REPO_DIR=/home/you/Faculty-Jobs ./deploy/jetson/setup.sh

set -euo pipefail

REPO_DIR="${REPO_DIR:-$HOME/Faculty-Jobs}"
OLLAMA_MODEL="${OLLAMA_MODEL:-qwen2.5:3b}"

echo "== Faculty Atlas / Jetson setup =="
echo "Repo dir     : $REPO_DIR"
echo "Ollama model : $OLLAMA_MODEL"
echo

# -- 1. System packages -------------------------------------------------------
echo "-- Installing base packages --"
sudo apt-get update
sudo apt-get install -y curl git build-essential ca-certificates

# -- 1b. Swap ------------------------------------------------------------------
# The scraper can run 20+ concurrent Chromium renderers at default concurrency.
# JetPack ships with zero swap by default, so a memory spike has nowhere to go
# but the OOM killer. A swapfile is a cheap backstop even with concurrency
# throttled down (see MAX_PARALLEL_CAMPUSES/MAX_PARALLEL_SYSTEMS below).
if [[ -z "$(swapon --show)" ]]; then
    echo "-- No swap detected — creating a 4GB swapfile at /swapfile --"
    sudo fallocate -l 4G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    if ! grep -q '^/swapfile ' /etc/fstab; then
        echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
    fi
else
    echo "-- Swap already configured: --"
    swapon --show
fi

# -- 2. Node.js (arm64) --------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
    echo "-- Installing Node.js 22 LTS --"
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
else
    echo "-- Node.js already installed: $(node -v) --"
fi

# -- 3. Ollama ------------------------------------------------------------------
if ! command -v ollama >/dev/null 2>&1; then
    echo "-- Installing Ollama --"
    curl -fsSL https://ollama.com/install.sh | sh
else
    echo "-- Ollama already installed --"
fi

# NOTE: the official installer may fall back to CPU-only inference on Jetson
# (its CUDA detection doesn't always recognize the Tegra iGPU / JetPack's
# userspace stack). CPU inference with a 3B model is still fine for an
# overnight batch job — if enrichment throughput becomes a problem, look at
# dusty-nv/jetson-containers' prebuilt Ollama image for GPU acceleration
# instead of the generic installer.
echo "-- Pulling $OLLAMA_MODEL (this can take a while on first run) --"
ollama pull "$OLLAMA_MODEL"

# -- 4. Repo deps ---------------------------------------------------------------
if [[ ! -d "$REPO_DIR/.git" ]]; then
    echo "ERROR: $REPO_DIR is not a git repo. Clone it first, e.g.:"
    echo "  git clone git@github.com:<you>/Faculty-Jobs.git $REPO_DIR"
    exit 1
fi

cd "$REPO_DIR"
echo "-- npm ci --"
npm ci

echo "-- Installing Playwright's Chromium --"
# Playwright ships arm64 Linux Chromium builds; --with-deps installs the
# matching apt packages. If this 404s on your JetPack/Ubuntu version, install
# chromium-browser via apt instead and point PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
# + a browser channel in the scraper config.
npx playwright install --with-deps chromium

# -- 5. systemd service + timer --------------------------------------------------
echo "-- Installing systemd units --"
SERVICE_SRC="$REPO_DIR/deploy/jetson/faculty-atlas-daily-update.service"
TIMER_SRC="$REPO_DIR/deploy/jetson/faculty-atlas-daily-update.timer"

CURRENT_USER="$(whoami)"
sudo sed \
    -e "s#REPLACE_WITH_YOUR_USERNAME#${CURRENT_USER}#g" \
    -e "s#/home/${CURRENT_USER}/Faculty-Jobs#${REPO_DIR}#g" \
    -e "s#Environment=OLLAMA_MODEL=qwen2.5:3b#Environment=OLLAMA_MODEL=${OLLAMA_MODEL}#g" \
    "$SERVICE_SRC" > /tmp/faculty-atlas-daily-update.service
sudo mv /tmp/faculty-atlas-daily-update.service /etc/systemd/system/faculty-atlas-daily-update.service
sudo cp "$TIMER_SRC" /etc/systemd/system/faculty-atlas-daily-update.timer

sudo systemctl daemon-reload
sudo systemctl enable --now faculty-atlas-daily-update.timer

echo
echo "== Done =="
echo "Check the schedule   : systemctl list-timers faculty-atlas-daily-update.timer"
echo "Run once, right now  : sudo systemctl start faculty-atlas-daily-update.service"
echo "Watch logs live      : journalctl -u faculty-atlas-daily-update.service -f"
echo "Or check the script's own log file under generated/automation-logs/"
