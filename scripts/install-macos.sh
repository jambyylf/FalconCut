#!/usr/bin/env bash
# FalconCut орнатушысы (macOS): серверді жинайды, FalconCut CEP панелін орнатады,
# Adobe CEP debug режимін қосады және Claude Desktop баптауына falconcut жазбасын қосады.
# Барлық хабарламалар locales/<тіл>.json ішінде (әдепкі тіл — kk, ағылшынша: FALCONCUT_LANG=en).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=scripts/i18n.sh
source "$SCRIPT_DIR/i18n.sh"

SKIP_BUILD=false
if [[ "${1:-}" == "--skip-build" ]]; then
  SKIP_BUILD=true
  shift
fi

if [[ "$#" -gt 0 ]]; then
  echo "$(t setup.unknown_option "$1")"
  exit 1
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "$(t setup.macos_only)"
  exit 1
fi

CEP_EXTENSIONS_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions"
CEP_TARGET_DIR="$CEP_EXTENSIONS_DIR/FalconCut"
CLAUDE_CONFIG_PATH="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
TEMP_DIR="/tmp/falconcut-bridge"
DIST_ENTRY="$REPO_ROOT/dist/index.js"

if ! command -v node >/dev/null 2>&1; then
  # Node жоқ кезде аудармаларды оқи алмаймыз, сондықтан хабарлама екі тілде
  echo "Node.js 20+ қажет, бірақ 'node' табылмады. / Node.js 20+ is required but 'node' was not found."
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  echo "$(t setup.node_too_old "$(node -v)")"
  exit 1
fi

if [[ "$SKIP_BUILD" == "true" ]]; then
  echo "$(t setup.using_packaged_build)"
else
  echo "$(t setup.npm_install)"
  npm install --prefix "$REPO_ROOT"

  echo "$(t setup.building)"
  npm run build --prefix "$REPO_ROOT"
fi

if [[ ! -f "$DIST_ENTRY" ]]; then
  echo "$(t setup.build_missing "$DIST_ENTRY")"
  exit 1
fi

echo "$(t setup.debug_mode)"
defaults write com.adobe.CSXS.12 PlayerDebugMode 1
defaults write com.adobe.CSXS.11 PlayerDebugMode 1
defaults write com.adobe.CSXS.10 PlayerDebugMode 1

echo "$(t setup.installing_cep "$CEP_TARGET_DIR")"
mkdir -p "$CEP_EXTENSIONS_DIR"
mkdir -p "$CEP_TARGET_DIR"
# Copy over the live extension so a running panel is not deleted out from
# under itself.
cp -R "$REPO_ROOT/cep-plugin/." "$CEP_TARGET_DIR/"
# Панель мәтіндерін locales/ папкасынан оқиды — оны панельдің қасына көшіреміз
mkdir -p "$CEP_TARGET_DIR/locales"
cp -R "$REPO_ROOT/locales/." "$CEP_TARGET_DIR/locales/"

echo "$(t setup.preparing_bridge_dir "$TEMP_DIR")"
mkdir -p "$TEMP_DIR"

echo "$(t setup.updating_claude_desktop "$CLAUDE_CONFIG_PATH")"
mkdir -p "$(dirname "$CLAUDE_CONFIG_PATH")"
CONFIG_PATH="$CLAUDE_CONFIG_PATH" DIST_PATH="$DIST_ENTRY" TEMP_PATH="$TEMP_DIR" \
  INVALID_JSON_MESSAGE="$(t setup.config_invalid_json "$CLAUDE_CONFIG_PATH" "{error}")" node -e '
const fs = require("fs");

const configPath = process.env.CONFIG_PATH;
const distPath = process.env.DIST_PATH;
const tempPath = process.env.TEMP_PATH;

let data = {};

if (fs.existsSync(configPath)) {
  const raw = fs.readFileSync(configPath, "utf8").trim();
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch (error) {
      console.error(process.env.INVALID_JSON_MESSAGE.replace("{error}", error.message));
      process.exit(1);
    }
  }
}

if (!data || typeof data !== "object" || Array.isArray(data)) {
  data = {};
}

if (!data.mcpServers || typeof data.mcpServers !== "object" || Array.isArray(data.mcpServers)) {
  data.mcpServers = {};
}

data.mcpServers["falconcut"] = {
  command: "node",
  args: [distPath],
  env: {
    FALCONCUT_BRIDGE_DIR: tempPath
  }
};

fs.writeFileSync(configPath, `${JSON.stringify(data, null, 2)}\n`);
'

echo
echo "$(t setup.complete)"
echo "$(t setup.next)"
echo "$(t setup.next_restart_clients_mac)"
echo "$(t setup.next_restart_premiere)"
echo "$(t setup.next_open_panel)"
echo "$(t setup.next_check_folder "$TEMP_DIR")"
echo "$(t setup.next_verify)"
echo
echo "$(t setup.manual_entry)"
echo "  command: node"
echo "  args:    $DIST_ENTRY"
echo "  env:     FALCONCUT_BRIDGE_DIR=$TEMP_DIR"
