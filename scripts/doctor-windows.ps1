<#
.SYNOPSIS
    Verifies the Windows FalconCut install.

.DESCRIPTION
    FalconCut тексерісі (Windows): Node.js, сервер жинағы, CEP панелі, көпір папкасы,
    Adobe CEP debug режимі, MCP клиент баптаулары және панельдің қазір жұмыс
    істеп тұрғаны. Мәтіндер locales/<тіл>.json ішінде (әдепкі тіл - kk).
#>

[CmdletBinding()]
param(
    [string] $TempDir = (Join-Path $env:TEMP 'falconcut-bridge'),
    [string] $VsCodeConfigPath = (Join-Path $env:APPDATA 'Code\User\mcp.json'),
    [string] $ClaudeConfigPath = (Join-Path $env:APPDATA 'Claude\claude_desktop_config.json')
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
. (Join-Path $scriptDir 'i18n.ps1')
Initialize-FalconCutMessages -RepoRoot $repoRoot

if ($env:OS -ne 'Windows_NT') {
    throw (T 'doctor.windows_only')
}

$cepTargetDir = Join-Path $env:APPDATA 'Adobe\CEP\extensions\FalconCut'
$distEntry = Join-Path $repoRoot 'dist\index.js'
$failures = 0

function Pass([string] $Message) {
    Write-Host ('  [' + (T 'doctor.tag_ok') + '] ' + $Message)
}

function Warn([string] $Message) {
    Write-Host ('  [' + (T 'doctor.tag_warn') + '] ' + $Message)
}

function Info([string] $Message) {
    Write-Host ('  [' + (T 'doctor.tag_info') + '] ' + $Message)
}

function Fail([string] $Message) {
    Write-Host ('  [' + (T 'doctor.tag_fail') + '] ' + $Message)
    $script:failures++
}

function Test-JsonServer([string] $Path, [string] $RootKey) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        Warn (T 'doctor.config_file_missing' @($Path))
        return
    }

    $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    if ([string]::IsNullOrWhiteSpace($raw)) {
        Fail (T 'doctor.config_empty' @($Path))
        return
    }

    try {
        $json = $raw | ConvertFrom-Json
    } catch {
        Fail (T 'doctor.config_invalid' @($Path))
        return
    }

    $root = $json.PSObject.Properties[$RootKey]
    if (-not $root) {
        Fail (T 'doctor.config_missing_root' @($Path, $RootKey))
        return
    }

    $server = $root.Value.PSObject.Properties['falconcut']
    if (-not $server) {
        Fail (T 'doctor.config_missing_server' @($Path))
        return
    }

    Pass (T 'doctor.config_ok' @($Path))
}

Write-Host (T 'doctor.title' @('Windows'))
Write-Host ''

Write-Host (T 'doctor.section_node')
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    # Both languages on purpose: the check itself is about the missing runtime.
    Fail "Node.js PATH ішінде табылмады. / node not found on PATH"
} else {
    $nodeVersion = & $node.Source -v
    $nodeMajor = [int](& $node.Source -p "process.versions.node.split('.')[0]")
    if ($nodeMajor -lt 20) {
        Fail (T 'doctor.node_too_old' @($nodeVersion))
    } else {
        Pass (T 'doctor.node_ok' @($nodeVersion))
    }
}

Write-Host (T 'doctor.section_build')
if (Test-Path -LiteralPath $distEntry -PathType Leaf) {
    Pass (T 'doctor.build_ok' @($distEntry))
} else {
    Fail (T 'doctor.build_missing' @($distEntry))
}

Write-Host (T 'doctor.section_cep')
$manifestPath = Join-Path $cepTargetDir 'CSXS\manifest.xml'
$localePath = Join-Path $cepTargetDir 'locales\kk.json'
if ((Test-Path -LiteralPath $manifestPath -PathType Leaf) -and (Test-Path -LiteralPath $localePath -PathType Leaf)) {
    Pass (T 'doctor.cep_ok' @($cepTargetDir))
} elseif (Test-Path -LiteralPath $cepTargetDir) {
    Fail (T 'doctor.cep_incomplete' @($cepTargetDir))
} else {
    Fail (T 'doctor.cep_missing' @($cepTargetDir))
}

Write-Host (T 'doctor.section_bridge_dir')
if (Test-Path -LiteralPath $TempDir -PathType Container) {
    Pass (T 'doctor.bridge_dir_ok' @($TempDir))
} else {
    Fail (T 'doctor.bridge_dir_missing' @($TempDir))
}

Write-Host (T 'doctor.section_debug_mode')
$debugModeFound = $false
foreach ($version in 9..15) {
    $key = "HKCU:\Software\Adobe\CSXS.$version"
    if (Test-Path -LiteralPath $key) {
        # The CSXS key can exist without PlayerDebugMode (Adobe apps create it); under
        # StrictMode reading a missing property throws, so look it up by name instead.
        $properties = Get-ItemProperty -Path $key -ErrorAction SilentlyContinue
        $value = $null
        if ($properties -and $properties.PSObject.Properties['PlayerDebugMode']) {
            $value = $properties.PlayerDebugMode
        }
        if ("$value" -eq '1') {
            $debugModeFound = $true
            Pass (T 'doctor.debug_ok' @($version))
        }
    }
}
if (-not $debugModeFound) {
    Warn (T 'doctor.debug_none')
}

Write-Host (T 'doctor.section_copilot')
Test-JsonServer -Path $VsCodeConfigPath -RootKey 'servers'

Write-Host (T 'doctor.section_claude_desktop')
Test-JsonServer -Path $ClaudeConfigPath -RootKey 'mcpServers'

# Claude Code's .mcp.json runs "falconcut-mcp", so it has to be on PATH.
Write-Host (T 'doctor.section_cli')
$cli = Get-Command falconcut-mcp -ErrorAction SilentlyContinue
if ($cli) {
    Pass (T 'doctor.cli_ok' @($cli.Source))
} else {
    Warn (T 'doctor.cli_missing')
}

# sync_by_audio and detect_silence read audio through ffmpeg (FALCONCUT_FFMPEG = full path).
Write-Host (T 'doctor.section_ffmpeg')
$ffmpegName = if ($env:FALCONCUT_FFMPEG) { $env:FALCONCUT_FFMPEG } else { 'ffmpeg' }
$ffmpeg = Get-Command $ffmpegName -ErrorAction SilentlyContinue
if ($ffmpeg) {
    Pass (T 'doctor.ffmpeg_ok' @($ffmpeg.Source))
} else {
    Warn (T 'doctor.ffmpeg_missing' @('winget install Gyan.FFmpeg'))
}

# The panel rewrites bridge-heartbeat.json every 250 ms while Premiere has it open.
Write-Host (T 'doctor.section_panel')
$heartbeatPath = Join-Path $TempDir 'bridge-heartbeat.json'
$panelState = 'offline'
$heartbeatAge = 0
if (Test-Path -LiteralPath $heartbeatPath -PathType Leaf) {
    try {
        $beat = Get-Content -LiteralPath $heartbeatPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $nowMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        $heartbeatAge = [math]::Round(($nowMs - [double]$beat.t) / 1000, 1)
        if ($heartbeatAge -ge 0 -and $heartbeatAge -lt 5) {
            if ($beat.started) { $panelState = 'live' } else { $panelState = 'stopped' }
        }
    } catch {
        $panelState = 'offline'
    }
}
if ($panelState -eq 'live') {
    Pass (T 'doctor.panel_live' @($heartbeatAge))
} elseif ($panelState -eq 'stopped') {
    Warn (T 'doctor.panel_stopped')
} else {
    Info (T 'doctor.panel_offline')
}
Info (T 'doctor.manual_panel_check')

Write-Host ''
if ($failures -gt 0) {
    Write-Host (T 'doctor.failed' @($failures))
    exit 1
}

Write-Host (T 'doctor.passed')
