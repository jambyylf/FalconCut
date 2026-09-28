<#
.SYNOPSIS
    Installs the FalconCut MCP server and CEP panel on Windows.

.DESCRIPTION
    Builds the MCP server, installs the FalconCut CEP panel into the per-user Adobe CEP
    extensions folder, enables CEP debug mode, creates the bridge folder, and writes
    MCP client config for GitHub Copilot in VS Code and Claude Desktop.

    FalconCut орнатушысы (Windows). Қолданушыға көрсетілетін мәтіндер
    locales/<тіл>.json ішінде (әдепкі тіл - kk, ағылшынша: $env:FALCONCUT_LANG = 'en').

.PARAMETER TempDir
    Bridge folder shared by the MCP server and the FalconCut panel.

.PARAMETER VsCodeConfigPath
    VS Code MCP config used by GitHub Copilot.

.PARAMETER ClaudeConfigPath
    Claude Desktop MCP config path.

.PARAMETER SkipBuild
    Skip npm install and npm run build. Useful for CI after build has already run.

.PARAMETER SkipCopilotConfig
    Do not write the VS Code GitHub Copilot MCP config.

.PARAMETER SkipClaudeDesktopConfig
    Do not write Claude Desktop MCP config.

.PARAMETER SkipAdobeDebugMode
    Do not write Adobe CEP PlayerDebugMode registry values.
#>

[CmdletBinding()]
param(
    [string] $TempDir = (Join-Path $env:TEMP 'falconcut-bridge'),
    [string] $VsCodeConfigPath = (Join-Path $env:APPDATA 'Code\User\mcp.json'),
    [string] $ClaudeConfigPath = (Join-Path $env:APPDATA 'Claude\claude_desktop_config.json'),
    [switch] $SkipBuild,
    [switch] $SkipCopilotConfig,
    [switch] $SkipClaudeDesktopConfig,
    [switch] $SkipAdobeDebugMode
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
. (Join-Path $scriptDir 'i18n.ps1')
Initialize-FalconCutMessages -RepoRoot $repoRoot

if ($env:OS -ne 'Windows_NT') {
    throw (T 'setup.windows_only')
}

$cepExtensionsDir = Join-Path $env:APPDATA 'Adobe\CEP\extensions'
$cepTargetDir = Join-Path $cepExtensionsDir 'FalconCut'
$distEntry = Join-Path $repoRoot 'dist\index.js'

function Resolve-CommandPath([string] $Name) {
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $command) { return $null }
    return $command.Source
}

function Update-JsonWithNode([string] $ConfigPath, [string] $Mode) {
    $configDir = Split-Path -Parent $ConfigPath
    if (-not (Test-Path -LiteralPath $configDir)) {
        New-Item -ItemType Directory -Path $configDir -Force | Out-Null
    }

    $helper = @'
const fs = require("fs");

const configPath = process.env.CONFIG_PATH;
const mode = process.env.CONFIG_MODE;
const nodePath = process.env.NODE_PATH_VALUE;
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

if (mode === "copilot") {
  if (!data.servers || typeof data.servers !== "object" || Array.isArray(data.servers)) {
    data.servers = {};
  }
  data.servers["falconcut"] = {
    type: "stdio",
    command: nodePath,
    args: [distPath],
    env: {
      FALCONCUT_BRIDGE_DIR: tempPath
    }
  };
} else if (mode === "claude") {
  if (!data.mcpServers || typeof data.mcpServers !== "object" || Array.isArray(data.mcpServers)) {
    data.mcpServers = {};
  }
  data.mcpServers["falconcut"] = {
    command: nodePath,
    args: [distPath],
    env: {
      FALCONCUT_BRIDGE_DIR: tempPath
    }
  };
} else {
  console.error(`Unknown config mode: ${mode}`);
  process.exit(1);
}

fs.writeFileSync(configPath, `${JSON.stringify(data, null, 2)}\n`);
'@

    $helperPath = Join-Path $env:TEMP 'falconcut-config-update.cjs'
    Set-Content -LiteralPath $helperPath -Value $helper -Encoding UTF8

    $oldConfigPath = $env:CONFIG_PATH
    $oldConfigMode = $env:CONFIG_MODE
    $oldNodePathValue = $env:NODE_PATH_VALUE
    $oldDistPath = $env:DIST_PATH
    $oldTempPath = $env:TEMP_PATH
    $oldInvalidJsonMessage = $env:INVALID_JSON_MESSAGE
    try {
        $env:CONFIG_PATH = $ConfigPath
        $env:CONFIG_MODE = $Mode
        $env:NODE_PATH_VALUE = $script:nodePath
        $env:DIST_PATH = $distEntry
        $env:TEMP_PATH = $TempDir
        $env:INVALID_JSON_MESSAGE = (T 'setup.config_invalid_json' @($ConfigPath, '{error}'))
        & $script:nodePath $helperPath
        if ($LASTEXITCODE -ne 0) {
            throw (T 'setup.config_update_failed' @($ConfigPath))
        }
    } finally {
        $env:CONFIG_PATH = $oldConfigPath
        $env:CONFIG_MODE = $oldConfigMode
        $env:NODE_PATH_VALUE = $oldNodePathValue
        $env:DIST_PATH = $oldDistPath
        $env:TEMP_PATH = $oldTempPath
        $env:INVALID_JSON_MESSAGE = $oldInvalidJsonMessage
        Remove-Item -LiteralPath $helperPath -Force -ErrorAction SilentlyContinue
    }
}

$script:nodePath = Resolve-CommandPath 'node'
if (-not $script:nodePath) {
    # Both languages on purpose: this is the one message that must work before anything else.
    throw "Node.js 20+ қажет, бірақ 'node' PATH ішінде табылмады. / Node.js 20+ is required but 'node' was not found on PATH."
}

$nodeMajor = [int](& $script:nodePath -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 20) {
    throw (T 'setup.node_too_old' @(& $script:nodePath -v))
}

$npmPath = Resolve-CommandPath 'npm.cmd'
if (-not $npmPath) { $npmPath = Resolve-CommandPath 'npm' }
if (-not $npmPath) {
    throw (T 'setup.npm_missing')
}

if ($SkipBuild) {
    Write-Host (T 'setup.skip_build')
} else {
    Write-Host (T 'setup.npm_install')
    & $npmPath install --prefix $repoRoot
    if ($LASTEXITCODE -ne 0) { throw (T 'setup.npm_install_failed') }

    Write-Host (T 'setup.building')
    & $npmPath run build --prefix $repoRoot
    if ($LASTEXITCODE -ne 0) { throw (T 'setup.build_failed') }
}

if (-not (Test-Path -LiteralPath $distEntry -PathType Leaf)) {
    throw (T 'setup.build_missing' @($distEntry))
}

if ($SkipAdobeDebugMode) {
    Write-Host (T 'setup.skip_debug_mode')
} else {
    Write-Host (T 'setup.debug_mode')
    foreach ($version in 9..15) {
        $key = "HKCU:\Software\Adobe\CSXS.$version"
        if (-not (Test-Path -LiteralPath $key)) {
            New-Item -Path $key -Force | Out-Null
        }
        New-ItemProperty -Path $key -Name 'PlayerDebugMode' -Value '1' -PropertyType String -Force | Out-Null
    }
}

Write-Host (T 'setup.installing_cep' @($cepTargetDir))
if (-not (Test-Path -LiteralPath $cepExtensionsDir)) {
    New-Item -ItemType Directory -Path $cepExtensionsDir -Force | Out-Null
}
if (-not (Test-Path -LiteralPath $cepTargetDir)) {
    New-Item -ItemType Directory -Path $cepTargetDir -Force | Out-Null
}
# Copy over the live extension so a running panel is not deleted out from
# under itself.
Copy-Item -Path (Join-Path $repoRoot 'cep-plugin\*') -Destination $cepTargetDir -Recurse -Force
# The panel reads its text from locales\ next to itself.
$cepLocalesDir = Join-Path $cepTargetDir 'locales'
if (-not (Test-Path -LiteralPath $cepLocalesDir)) {
    New-Item -ItemType Directory -Path $cepLocalesDir -Force | Out-Null
}
Copy-Item -Path (Join-Path $repoRoot 'locales\*') -Destination $cepLocalesDir -Recurse -Force

Write-Host (T 'setup.preparing_bridge_dir' @($TempDir))
if (-not (Test-Path -LiteralPath $TempDir)) {
    New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
}

if ($SkipCopilotConfig) {
    Write-Host (T 'setup.skip_copilot')
} else {
    Write-Host (T 'setup.updating_copilot' @($VsCodeConfigPath))
    Update-JsonWithNode -ConfigPath $VsCodeConfigPath -Mode 'copilot'
}

if ($SkipClaudeDesktopConfig) {
    Write-Host (T 'setup.skip_claude_desktop')
} else {
    Write-Host (T 'setup.updating_claude_desktop' @($ClaudeConfigPath))
    Update-JsonWithNode -ConfigPath $ClaudeConfigPath -Mode 'claude'
}

Write-Host ''
Write-Host (T 'setup.complete')
Write-Host (T 'setup.next')
Write-Host (T 'setup.next_restart_clients_win')
Write-Host (T 'setup.next_restart_premiere')
Write-Host (T 'setup.next_open_panel')
Write-Host (T 'setup.next_check_folder' @($TempDir))
Write-Host (T 'setup.next_verify')
Write-Host ''
Write-Host (T 'setup.manual_entry')
Write-Host "  command: $script:nodePath"
Write-Host "  args:    $distEntry"
Write-Host "  env:     FALCONCUT_BRIDGE_DIR=$TempDir"
