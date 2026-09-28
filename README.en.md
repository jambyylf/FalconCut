<div align="center">

# FalconCut

**An MCP server for driving Adobe Premiere Pro with AI — Kazakh-first.**

[![License: MIT](https://img.shields.io/badge/License-MIT-5fd3c6.svg)](LICENSE.md)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933.svg)](https://nodejs.org/)
[![Telemetry](https://img.shields.io/badge/telemetry-none-2ea44f.svg)](PRIVACY.md)

**Languages:** [Қазақша](README.md) | English

</div>

## What is FalconCut?

FalconCut is local software that lets AI assistants such as Claude Code, Claude Desktop, and Codex work with your Premiere Pro project. You ask the assistant for an edit in plain language, and it performs real editing operations inside Premiere.

- **283 Premiere tools:** projects, media import, sequences, timeline editing, effects, color, audio, captions, markers, and export.
- **The FalconCut panel inside Premiere** — Kazakh interface by default, English on request.
- **A Kazakh-speaking assistant:** the bundled agent skill talks to you in Kazakh and checks that ә, ғ, қ, ң, ө, ұ, ү, һ, і render correctly in captions and titles.
- **No telemetry:** FalconCut makes no network requests at all ([PRIVACY.md](PRIVACY.md)).

### How it works

```text
+--------------+         +---------------+         +-------------------+
| AI client    |   MCP   | FalconCut     |  files  | FalconCut panel   |
| (Claude,     |<------->| MCP server    |<------->| (inside Premiere) |
|  Codex ...)  |         | (Node.js)     |         |                   |
+--------------+         +---------------+         +-------------------+
                                                             |
                                                             v
                                                   +-------------------+
                                                   | Premiere Pro      |
                                                   +-------------------+
```

1. The AI client calls an MCP tool.
2. The FalconCut server writes ExtendScript into the **temp folder** (macOS: `/tmp/falconcut-bridge`, Windows: `%TEMP%\falconcut-bridge`).
3. The FalconCut panel inside Premiere watches that folder and runs the script.
4. The result travels back the same way.

## Requirements

- Adobe Premiere Pro 2020 or newer (used with 2025 and 2026)
- [Node.js](https://nodejs.org/) 20 or newer
- [Git](https://git-scm.com/)
- Premiere, the AI client, and FalconCut on **the same computer**

## Install — macOS

Open Terminal and run:

```bash
git clone https://github.com/jambyylf/FalconCut.git
cd FalconCut
npm run setup:mac
npm link
falconcut-mcp --doctor
```

What happens:

- `npm run setup:mac` installs dependencies, builds the server, copies the FalconCut panel to `~/Library/Application Support/Adobe/CEP/extensions/FalconCut`, enables Adobe CEP debug mode, creates `/tmp/falconcut-bridge`, and adds a `falconcut` entry to the Claude Desktop config.
- `npm link` puts the `falconcut-mcp` command on your PATH (Claude Code's `.mcp.json` uses it).
- `falconcut-mcp --doctor` checks the whole install.

Then restart Premiere Pro and open **Window > Extensions > FalconCut**. The bridge starts by itself.

## Install — Windows

Open PowerShell and run:

```powershell
git clone https://github.com/jambyylf/FalconCut.git
cd FalconCut
npm run setup:win
npm link
falconcut-mcp --doctor
```

What happens:

- `npm run setup:win` installs dependencies, builds the server, copies the FalconCut panel to `%APPDATA%\Adobe\CEP\extensions\FalconCut`, enables Adobe CEP debug mode in the registry, creates `%TEMP%\falconcut-bridge`, and adds a `falconcut` entry to the VS Code (GitHub Copilot) and Claude Desktop configs.
- Skip those clients with: `npm run setup:win -- -SkipCopilotConfig -SkipClaudeDesktopConfig`
- `npm link` puts the `falconcut-mcp` command on your PATH.
- `falconcut-mcp --doctor` checks the install.

Then restart Premiere Pro and open **Window > Extensions > FalconCut**.

## Connect Claude Code (.mcp.json)

The repository root contains `.mcp.json`:

```json
{
  "mcpServers": {
    "falconcut": {
      "command": "falconcut-mcp"
    }
  }
}
```

1. Make sure `npm link` has run (`falconcut-mcp --version` prints the version).
2. Open Claude Code in this folder. It finds `.mcp.json` and asks to enable the `falconcut` server — answer **Yes**.
3. Check with `/mcp` that `falconcut` is connected.

**To use it from any folder** (for example, where your video projects live), register it once for your user:

```bash
claude mcp add falconcut --scope user -- falconcut-mcp
```

**Windows note:** on Windows `npm link` creates `falconcut-mcp.cmd`. Claude Code 2.1 starts it directly (checked on Windows 11). If an older version does not connect `falconcut` in `/mcp`, register it like this:

```powershell
claude mcp add falconcut --scope user -- cmd /c falconcut-mcp
```

To use a different temp folder, add an `env` block (and set the same folder in the panel's «Уақытша папка» / Temp folder field):

```json
"env": { "FALCONCUT_BRIDGE_DIR": "/some/other/path" }
```

## First check

With Premiere and the FalconCut panel open, ask your AI client:

> Run verify_premiere_connection. Make no changes to the project.

The answer shows the Premiere version, the open project, and the active sequence. The tool is read-only.

## Language

- **Panel:** pick «Қазақша» or «English» in the **Тіл** (Language) list inside the collapsed **Қосымша** (More) section. The choice is saved to `~/.falconcut/config.json`, and the CLI and `--doctor` follow it.
- **CLI and `--doctor`:** `FALCONCUT_LANG=en falconcut-mcp --doctor` (Windows PowerShell: `$env:FALCONCUT_LANG='en'; falconcut-mcp --doctor`).
- All user-facing text lives in [`locales/kk.json`](locales/kk.json) and [`locales/en.json`](locales/en.json).
- MCP tool names and descriptions intentionally stay in English — they are read by the AI, not by people.

## Limitations

- Premiere's scripting API does not expose every UI operation; FalconCut reports unsupported operations instead of pretending.
- Professional titles depend on real `.mogrt` (Motion Graphics) templates.
- The export queue needs Adobe Media Encoder.
- `detect_silence` needs `ffmpeg` on `PATH`.
- The FalconCut panel is an unsigned CEP extension, so the installer enables Adobe CEP debug mode. Occasionally Premiere also needs **Settings > Plugins > Enable developer mode** ([screenshot](images/uxp-developer-mode.png)).
- `uxp-plugin/` is an experimental panel: the installer does not install it and it is not translated.
- For Kazakh captions and titles choose a font that covers the Kazakh Cyrillic letters (for example Arial, Segoe UI, Noto Sans); otherwise the letters show as empty boxes.
- FalconCut is not published to npm — install it from this repository with `git clone`.
- Premiere, the AI client, and FalconCut must run on the same computer.

## Troubleshooting

1. Run `falconcut-mcp --doctor` — it tells you what is missing.
2. Check that Premiere is open with a project and that **Window > Extensions > FalconCut** is open.
3. The panel's Temp folder field must be `/tmp/falconcut-bridge` on macOS and `%TEMP%\falconcut-bridge` on Windows.
4. After updating FalconCut, click **Қайта жүктеу** (Reload) in the panel.
5. The **Диагностика** (Run Diagnostics) button in the **Қосымша** section writes `falconcut-diagnostics-latest.json` into the temp folder.

## Updating

FalconCut pulls improvements from the original project through the `upstream` remote:

```bash
git fetch upstream
git merge upstream/main
npm install
npm run build
```

Then rerun the installer (`npm run setup:mac` or `npm run setup:win`) and **Reload** the panel in Premiere.

## Uninstall

- **macOS:** `npm run uninstall:mac`, then `npm unlink -g falconcut-mcp`.
- **Windows:** delete `%APPDATA%\Adobe\CEP\extensions\FalconCut` and `%TEMP%\falconcut-bridge`, remove the `falconcut` entry from the Claude Desktop / VS Code configs, then run `npm unlink -g falconcut-mcp`.
- `~/.falconcut/` only holds panel settings; delete it if you no longer need it.

## Development

```bash
npm install
npm run build
npm test
falconcut-mcp --doctor
```

See also [QUICKSTART.md](QUICKSTART.md), [KNOWN_ISSUES.md](KNOWN_ISSUES.md), [CONTRIBUTING.md](CONTRIBUTING.md).

---

Based on [hetpatel-11/Adobe_Premiere_Pro_MCP](https://github.com/hetpatel-11/Adobe_Premiere_Pro_MCP). License: [MIT](LICENSE.md).
