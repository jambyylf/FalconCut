#!/usr/bin/env bash
# FalconCut жою скрипті (macOS): панельді, көпір папкасын және Claude Desktop-тағы
# falconcut жазбасын өшіреді. ~/.falconcut/ баптаулары әдейі сақталады.
# Хабарламалар locales/<тіл>.json ішінде (әдепкі тіл — kk, ағылшынша: FALCONCUT_LANG=en).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/i18n.sh
source "$SCRIPT_DIR/i18n.sh"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "$(t uninstall.macos_only)"
  exit 1
fi

CEP_TARGET_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions/FalconCut"
CLAUDE_CONFIG_PATH="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
TEMP_DIR="/tmp/falconcut-bridge"
CONFIG_DIR="$HOME/.falconcut"

echo "$(t uninstall.removing_cep "$CEP_TARGET_DIR")"
rm -rf "$CEP_TARGET_DIR"

echo "$(t uninstall.removing_bridge_dir "$TEMP_DIR")"
rm -rf "$TEMP_DIR"

if [[ -f "$CLAUDE_CONFIG_PATH" ]]; then
  echo "$(t uninstall.removing_claude_entry)"
  CONFIG_PATH="$CLAUDE_CONFIG_PATH" \
    INVALID_JSON_MESSAGE="$(t setup.config_invalid_json "$CLAUDE_CONFIG_PATH" "{error}")" node -e '
const fs = require("fs");

const configPath = process.env.CONFIG_PATH;
let data = {};

const raw = fs.readFileSync(configPath, "utf8").trim();
if (raw) {
  try {
    data = JSON.parse(raw);
  } catch (error) {
    console.error(process.env.INVALID_JSON_MESSAGE.replace("{error}", error.message));
    process.exit(1);
  }
}

if (data && typeof data === "object" && !Array.isArray(data) && data.mcpServers && typeof data.mcpServers === "object" && !Array.isArray(data.mcpServers)) {
  delete data.mcpServers["falconcut"];
}

fs.writeFileSync(configPath, `${JSON.stringify(data, null, 2)}\n`);
'
fi

echo
echo "$(t uninstall.complete)"
if [[ -d "$CONFIG_DIR" ]]; then
  echo "$(t uninstall.config_kept "$CONFIG_DIR")"
fi
echo "$(t uninstall.debug_mode_note)"
