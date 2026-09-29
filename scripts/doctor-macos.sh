#!/usr/bin/env bash
# FalconCut тексерісі (macOS): Node.js, сервер жинағы, CEP панелі, көпір папкасы,
# Adobe CEP debug режимі, MCP клиент баптаулары және панельдің қазір жұмыс істеп тұрғаны.
# Хабарламалар locales/<тіл>.json ішінде (әдепкі тіл — kk, ағылшынша: FALCONCUT_LANG=en).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=scripts/i18n.sh
source "$SCRIPT_DIR/i18n.sh"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "$(t doctor.macos_only)"
  exit 1
fi

DIST_ENTRY="$REPO_ROOT/dist/index.js"
CEP_TARGET_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions/FalconCut"
CLAUDE_CONFIG_PATH="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
TEMP_DIR="/tmp/falconcut-bridge"
FAILURES=0

pass() {
  echo "[$(t doctor.tag_ok)] $1"
}

fail() {
  echo "[$(t doctor.tag_fail)] $1"
  FAILURES=$((FAILURES + 1))
}

warn() {
  echo "[$(t doctor.tag_warn)] $1"
}

info() {
  echo "[$(t doctor.tag_info)] $1"
}

echo "$(t doctor.title macOS)"
echo

if command -v node >/dev/null 2>&1; then
  NODE_VERSION="$(node -v)"
  NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
  if [[ "$NODE_MAJOR" -ge 20 ]]; then
    pass "$(t doctor.node_ok "$NODE_VERSION")"
  else
    fail "$(t doctor.node_too_old "$NODE_VERSION")"
  fi
else
  # Node жоқ кезде аудармаларды оқи алмаймыз, сондықтан хабарлама екі тілде
  echo "[!] Node.js PATH ішінде табылмады. / Node.js not found in PATH."
  FAILURES=$((FAILURES + 1))
fi

if [[ -f "$DIST_ENTRY" ]]; then
  pass "$(t doctor.build_ok "$DIST_ENTRY")"
else
  fail "$(t doctor.build_missing "$DIST_ENTRY")"
fi

if [[ -d "$CEP_TARGET_DIR" ]]; then
  if [[ -f "$CEP_TARGET_DIR/CSXS/manifest.xml" && -f "$CEP_TARGET_DIR/index.html" && -f "$CEP_TARGET_DIR/locales/kk.json" ]]; then
    pass "$(t doctor.cep_ok "$CEP_TARGET_DIR")"
  else
    fail "$(t doctor.cep_incomplete "$CEP_TARGET_DIR")"
  fi
else
  fail "$(t doctor.cep_missing "$CEP_TARGET_DIR")"
fi

if [[ -d "$TEMP_DIR" ]]; then
  pass "$(t doctor.bridge_dir_ok "$TEMP_DIR")"
else
  fail "$(t doctor.bridge_dir_missing "$TEMP_DIR")"
fi

for csxs_version in 12 11 10; do
  VALUE="$(defaults read "com.adobe.CSXS.$csxs_version" PlayerDebugMode 2>/dev/null || true)"
  if [[ "$VALUE" == "1" ]]; then
    pass "$(t doctor.debug_ok "$csxs_version")"
  else
    fail "$(t doctor.debug_missing "$csxs_version")"
  fi
done

# Claude Desktop міндетті емес (Claude Code .mcp.json арқылы жұмыс істейді),
# сондықтан файл жоқ болса — тек ескерту. Файл бар, бірақ жазба қате болса — ақау.
if [[ -f "$CLAUDE_CONFIG_PATH" ]]; then
  CONFIG_CHECK="$(
    CONFIG_PATH="$CLAUDE_CONFIG_PATH" DIST_PATH="$DIST_ENTRY" TEMP_PATH="$TEMP_DIR" node -e '
const fs = require("fs");

const configPath = process.env.CONFIG_PATH;
const distPath = process.env.DIST_PATH;
const tempPath = process.env.TEMP_PATH;

try {
  const raw = fs.readFileSync(configPath, "utf8");
  const data = JSON.parse(raw);
  const server = data && data.mcpServers && data.mcpServers["falconcut"];

  if (!server) {
    console.log("missing-server");
    process.exit(0);
  }

  const arg0 = Array.isArray(server.args) ? server.args[0] : "";
  const temp = server.env && server.env.FALCONCUT_BRIDGE_DIR;

  if (server.command !== "node") {
    console.log(`bad-command:${server.command || ""}`);
  } else if (arg0 !== distPath) {
    console.log(`bad-path:${arg0}`);
  } else if (temp !== tempPath) {
    console.log(`bad-temp:${temp || ""}`);
  } else {
    console.log("ok");
  }
} catch (error) {
  console.log(`invalid-json:${error.message}`);
}
'
  )"

  case "$CONFIG_CHECK" in
    ok)
      pass "$(t doctor.config_ok "$CLAUDE_CONFIG_PATH")"
      ;;
    missing-server)
      fail "$(t doctor.config_missing_server "$CLAUDE_CONFIG_PATH")"
      ;;
    bad-command:*)
      fail "$(t doctor.config_bad_command "$CLAUDE_CONFIG_PATH" "${CONFIG_CHECK#bad-command:}")"
      ;;
    bad-path:*)
      fail "$(t doctor.config_bad_path "$CLAUDE_CONFIG_PATH" "${CONFIG_CHECK#bad-path:}")"
      ;;
    bad-temp:*)
      fail "$(t doctor.config_bad_bridge_dir "$CLAUDE_CONFIG_PATH" "${CONFIG_CHECK#bad-temp:}")"
      ;;
    invalid-json:*)
      fail "$(t doctor.config_invalid "$CLAUDE_CONFIG_PATH")"
      ;;
    *)
      fail "$(t doctor.config_unexpected "$CLAUDE_CONFIG_PATH" "$CONFIG_CHECK")"
      ;;
  esac
else
  warn "$(t doctor.config_file_missing "$CLAUDE_CONFIG_PATH")"
fi

# Claude Code-тың .mcp.json файлы "command": "falconcut-mcp" қолданады
if command -v falconcut-mcp >/dev/null 2>&1; then
  pass "$(t doctor.cli_ok "$(command -v falconcut-mcp)")"
else
  warn "$(t doctor.cli_missing)"
fi

# sync_by_audio, cut_silences және detect_silence дыбысты ffmpeg арқылы оқиды (FALCONCUT_FFMPEG — толық жол)
FFMPEG_BIN="${FALCONCUT_FFMPEG:-ffmpeg}"
if command -v "$FFMPEG_BIN" >/dev/null 2>&1; then
  pass "$(t doctor.ffmpeg_ok "$(command -v "$FFMPEG_BIN")")"
else
  warn "$(t doctor.ffmpeg_missing "brew install ffmpeg")"
fi

# Панель әр 250 мс сайын көпір папкасына bridge-heartbeat.json жазады
PANEL_STATE="$(
  HEARTBEAT_PATH="$TEMP_DIR/bridge-heartbeat.json" node -e '
try {
  const beat = JSON.parse(require("fs").readFileSync(process.env.HEARTBEAT_PATH, "utf8"));
  const age = (Date.now() - Number(beat.t)) / 1000;
  if (!(age >= 0 && age < 5)) console.log("offline");
  else console.log((beat.started ? "live:" : "stopped:") + age.toFixed(1));
} catch (error) {
  console.log("offline");
}
' 2>/dev/null || echo offline
)"
case "$PANEL_STATE" in
  live:*)
    pass "$(t doctor.panel_live "${PANEL_STATE#live:}")"
    ;;
  stopped:*)
    warn "$(t doctor.panel_stopped)"
    ;;
  *)
    info "$(t doctor.panel_offline)"
    ;;
esac
info "$(t doctor.manual_panel_check)"

if [[ "$FAILURES" -gt 0 ]]; then
  echo
  echo "$(t doctor.failed "$FAILURES")"
  exit 1
fi

echo
echo "$(t doctor.passed)"
