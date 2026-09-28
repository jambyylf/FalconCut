<#
.SYNOPSIS
    FalconCut: PowerShell scripts use this helper to read user-facing text.

.DESCRIPTION
    Қолданушыға көрсетілетін мәтіндер locales/<тіл>.json файлдарынан алынады,
    әдепкі тіл - kk. Тілді таңдау реті: FALCONCUT_LANG орта айнымалысы,
    содан кейін ~/.falconcut/config.json ішіндегі "language", болмаса kk.

    Қазақша мәтіндердің бәрі JSON файлдарында тұрады. .ps1 файлдары UTF-8 BOM-мен
    сақталады, әйтпесе Windows PowerShell 5.1 қазақ әріптерін дұрыс оқымайды.

    Usage (dot-source after $repoRoot is known):
        . (Join-Path $scriptDir 'i18n.ps1')
        Initialize-FalconCutMessages -RepoRoot $repoRoot
        Write-Host (T 'doctor.title')
        Write-Host (T 'doctor.node_ok' @($version))
#>

$script:FalconCutMessages = @{}

function Get-FalconCutLocale {
    $supported = @('kk', 'en')
    $fromEnv = "$env:FALCONCUT_LANG".Trim().ToLowerInvariant()
    if ($supported -contains $fromEnv) { return $fromEnv }

    $configPath = Join-Path $HOME '.falconcut\config.json'
    if (Test-Path -LiteralPath $configPath -PathType Leaf) {
        try {
            $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
            $fromConfig = "$($config.language)".Trim().ToLowerInvariant()
            if ($supported -contains $fromConfig) { return $fromConfig }
        } catch {
            # Broken config falls back to the default language.
        }
    }
    return 'kk'
}

function Read-FalconCutLocaleFile([string] $Path) {
    $table = @{}
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $table }
    try {
        $json = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($property in $json.PSObject.Properties) {
            if ($property.Value -is [string]) { $table[$property.Name] = $property.Value }
        }
    } catch {
        # Missing or broken locale file: callers fall back to the key itself.
    }
    return $table
}

function Initialize-FalconCutMessages([string] $RepoRoot) {
    # Kazakh letters must reach the console intact when output is piped or captured.
    try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }

    $localesDir = Join-Path $RepoRoot 'locales'
    $messages = Read-FalconCutLocaleFile (Join-Path $localesDir 'en.json')
    $selected = Read-FalconCutLocaleFile (Join-Path $localesDir ((Get-FalconCutLocale) + '.json'))
    foreach ($key in $selected.Keys) { $messages[$key] = $selected[$key] }
    $script:FalconCutMessages = $messages
}

function T([string] $Key, [object[]] $Values = @()) {
    $template = $script:FalconCutMessages[$Key]
    if (-not $template) { $template = $Key }
    if ($Values.Count -eq 0) { return $template }
    # {0}, {1} placeholders, same as locales/*.json. Replaced one by one instead of
    # with -f so a brace inside a path can never break the message.
    $text = $template
    for ($i = 0; $i -lt $Values.Count; $i++) {
        $text = $text.Replace('{' + $i + '}', "$($Values[$i])")
    }
    return $text
}
