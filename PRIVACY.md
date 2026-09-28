# Құпиялылық саясаты / Privacy Policy

Соңғы жаңартылған / Last updated: 2026-09-28

## Қазақша

FalconCut — тек сіздің компьютеріңізде жұмыс істейтін бағдарлама. Ол:

- телеметрия, қолданыс статистикасын немесе қате есептерін **жібермейді**;
- жаңа нұсқаны тексеру үшін де желіге **шықпайды**;
- Premiere жобасын, медиа файлдарды, құралдардың аргументтері мен нәтижелерін **ешқайда жібермейді**.

### Компьютеріңізде қалатын деректер

- **Уақытша папка** — macOS-та `/tmp/falconcut-bridge`, Windows-та `%TEMP%\falconcut-bridge`. MCP сервері мен Premiere-дегі FalconCut панелі осы папка арқылы команда және жауап файлдарымен алмасады. Бұл файлдарда жоба мен секвенция атаулары, медиа жолдары болуы мүмкін.
- **Баптаулар** — `~/.falconcut/config.json` (панель тілі мен уақытша папка).
- **Диагностика** — панельдің «Қосымша» бөліміндегі «Диагностика жасау» батырмасын басқанда уақытша папкаға `falconcut-diagnostics-latest.json` жазылады.

Бұл файлдарды өзіңіз біреуге жібермейінше, олар компьютеріңізден шықпайды.

### Үшінші тараптар

FalconCut-пен жұмыс істейтін AI клиенті (Claude Code, Claude Desktop, Codex, VS Code т.б.) өз провайдерінің серверімен байланысады. Бұл сол клиенттің құпиялылық саясатымен реттеледі, FalconCut оған әсер етпейді. Adobe Premiere Pro-ның өзі де Adobe саясатына бағынады.

## English

FalconCut is local software. It sends **no** telemetry, usage statistics, or crash reports, performs **no** update checks, and never sends Premiere project data, media, tool arguments, or tool results anywhere.

Data that stays on your computer:

- **Temp folder** — `/tmp/falconcut-bridge` on macOS, `%TEMP%\falconcut-bridge` on Windows. The MCP server and the FalconCut panel in Premiere exchange command and response files here; they can contain project and sequence names and media paths.
- **Settings** — `~/.falconcut/config.json` (panel language and temp folder).
- **Diagnostics** — `falconcut-diagnostics-latest.json` in the temp folder, written only when you click «Диагностика жасау» (Run Diagnostics) in the panel's «Қосымша» section.

The AI client you connect (Claude Code, Claude Desktop, Codex, VS Code, …) talks to its own provider under that provider's privacy policy. Adobe Premiere Pro is governed by Adobe's policies.

## Байланыс / Contact

https://github.com/jambyylf/FalconCut/issues
