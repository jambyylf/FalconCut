---
name: falconcut
description: Install, verify, troubleshoot, and operate FalconCut, the Kazakh-first Adobe Premiere Pro MCP server. Use when a user wants an agent to set up FalconCut, connect Claude Code/Codex/Claude Desktop, control Premiere, import media, build sequences, edit timelines, apply effects, write Kazakh captions or titles, or diagnose bridge issues.
---

# FalconCut (Adobe Premiere Pro MCP)

Use this skill when working with the FalconCut MCP server from `jambyylf/FalconCut` (based on `hetpatel-11/Adobe_Premiere_Pro_MCP`).

## Language: Kazakh first (Қазақ тілі)

Қысқаша: қолданушымен қазақша сөйлес, ал Premiere-ге жазылған қазақша мәтінде ә ғ қ ң ө ұ ү һ і әріптерінің дұрыс шыққанын міндетті түрде тексер.

- Talk to the user in Kazakh by default: explanations, questions, confirmations, progress reports, and error summaries. Switch language only if the user writes in another language or asks for one. Keep tool names, file paths, and code identifiers exactly as they are.
- Relay a tool's `nextStep` to the user in Kazakh, keeping menu and button names as Premiere shows them (for example `Window > Extensions > FalconCut`).
- FalconCut panel labels (Kazakh UI, English in brackets): status «Қосылған» / «Ажыратылған» (Connected / Disconnected); buttons «Көпірді іске қосу» (Start Bridge), «Көпірді тоқтату» (Stop Bridge), «Қайта жүктеу» (Reload); field «Уақытша папка» (temp folder); sections «Соңғы команда» (last command, shows the tool name and «Сәтті» / «Қате»), «Журнал» (log); the collapsed «Қосымша» section holds «Тіл» (language), «Диагностика жасау» (Run Diagnostics) and «Журналды тазалау» (Clear Log). Use these Kazakh names when you tell the user what to click.
- Whenever you write Kazakh text into Premiere — captions/subtitles (SRT), MOGRT titles, text overlays, marker names and comments, sequence/bin/clip names, metadata — verify the Kazakh-specific letters:
  1. Use the real Cyrillic code points: ә U+04D9, ғ U+0493, қ U+049B, ң U+04A3, ө U+04E9, ұ U+04B1, ү U+04AF, һ U+04BB, і U+0456 (uppercase Ә U+04D8, Ғ U+0492, Қ U+049A, Ң U+04A2, Ө U+04E8, Ұ U+04B0, Ү U+04AE, Һ U+04BA, І U+0406). Never substitute look-alikes: Latin `i`/`I`, `h`, `y`, `e`, `o`, `a`, Latin schwa `ə` (U+0259), or Russian `к г н у о и` in place of `қ ғ ң ү/ұ ө і`.
  2. After every write, read the value back with the narrowest read tool (`list_markers`, `get_mogrt_component`, `get_metadata`, `list_project_items`, `read_sequence_captions`, …) and compare it character by character with what you intended. Treat `?`, `□`, `�`, dropped letters, or look-alike substitutions as a failure and say so — never report success without the readback.
  3. Save `.srt` and other text files as UTF-8 (UTF-8 with BOM is the safest choice for Premiere's SRT import) and keep that encoding when converting.
  4. For titles and captions choose a font that covers Kazakh Cyrillic (for example Arial, Segoe UI, or Noto Sans). If the chosen font lacks a glyph, tell the user and suggest one of these.
  5. When Premiere cannot read the text back (existing caption text is often invisible to scripting), say the check could not be completed and ask the user to look at the Program monitor instead of assuming the letters are correct.

## Core Rules

- Use the MCP tools for Premiere operations; do not invent ExtendScript unless the MCP tool surface is missing the needed operation.
- Default MCP `tools/list` is a small always-on set. Call `search_tools` (BM25 query or regex pattern), then `invoke_tool` with the exact name. `FALCONCUT_TOOLSET=full` lists every tool.
- Prefer read-only discovery first: `get_project_info`, `list_sequences`, `list_project_items`, `get_active_sequence`, and relevant resource reads.
- Use real imported media. If the user asks to edit with assets, verify file paths exist, import them with `import_media`, then place the imported project item IDs on a sequence.
- Keep the temp (bridge) folder consistent across the MCP server and the panel's «Уақытша папка» field: `/tmp/falconcut-bridge` on macOS and `%TEMP%\falconcut-bridge` on Windows, unless the user explicitly set `FALCONCUT_BRIDGE_DIR`.
- Ask before destructive or externally visible actions: deleting clips/media, overwriting exports, closing projects, saving over important project files, or sending files elsewhere.
- For generated/demo edits, prefer creating a new clearly named sequence instead of modifying the user's active sequence.
- If a tool returns `success: false`, report the exact error (in Kazakh) and run diagnostics before retrying blindly.

## Install Workflow

If the user asks you to install or set up FalconCut:

1. Check the OS. There are installers for macOS and Windows.
2. Clone or open the repo:

```bash
git clone https://github.com/jambyylf/FalconCut.git
cd FalconCut
```

3. Run the installer, put the CLI on PATH, and check the result:

```bash
npm run setup:mac   # macOS
npm run setup:win   # Windows (PowerShell)
npm link
falconcut-mcp --doctor
```

4. Register the MCP server in the user's client. Claude Code picks up the repository's `.mcp.json` (`"command": "falconcut-mcp"`). For any other folder:

```bash
claude mcp add falconcut --scope user -- falconcut-mcp
```

On Windows, if the server does not connect, use `cmd /c falconcut-mcp` as the command.

For Codex:

```bash
codex mcp add falconcut -- falconcut-mcp
```

FalconCut is not published to npm; do not suggest `npx` or `npm install -g falconcut-mcp`.

## Premiere Panel Startup

After installing:

1. Restart the MCP client if it reads config only at startup.
2. Restart Premiere Pro.
3. Open `Window > Extensions > FalconCut`. The bridge starts by itself and the status shows «Қосылған».
4. Confirm the panel's `Уақытша папка` (temp folder) field matches the one above.
5. Confirm the panel status says «Қосылған» and call `verify_premiere_connection` before running editing tools.

If Premiere is not running, you can install/build/register the MCP, but tell the user that live verification needs Premiere and the FalconCut panel.

## Verification

Run local checks:

```bash
falconcut-mcp --doctor
```

`--doctor` also reports whether the panel is running in Premiere right now. If Premiere is running and the bridge is started, verify with safe read-only calls:

- `verify_premiere_connection`
- `get_project_info`
- `list_sequences`
- `list_project_items`

For deeper validation in a disposable project, create a test sequence with `create_sequence_from_clips` or `create_sequence` plus a real `.sqpreset` path, then call `list_sequences` and confirm it exists. Do not call blank sequence creation without a preset because newer Premiere versions can open a native dialog that blocks CEP.

## Editing Strategy

- Start by understanding the project: project info, active sequence, existing media, tracks, markers, and selected sequence.
- Build a plan in concrete Premiere operations before changing anything, and describe it to the user in Kazakh.
- For rough cuts, import media first, then use `create_sequence_from_clips` so Premiere derives settings without a native dialog. Use `create_sequence` only with a real `.sqpreset`; use `duplicate_sequence` with `clearContents=true` when an existing sequence defines the intended settings.
- For product or brand spots, prefer `assemble_product_spot` or `build_brand_spot_from_mogrt_and_assets` when the user's request fits those workflows.
- For black-and-white looks, use `apply_effect` with `Black & White` rather than generic saturation-only changes.
- For timeline cuts, prefer sequence-aware tools and include `sequenceId` when available.
- Export only after confirming output path, format/preset, and overwrite behavior.

## Troubleshooting

If commands time out or report bridge errors:

1. Confirm Premiere is open.
2. Confirm `Window > Extensions > FalconCut` is open and the bridge is started.
3. Confirm both sides use the same temp folder («Уақытша папка» in the panel).
4. Run `falconcut-mcp --doctor`.
5. Ask the user to open the panel's «Қосымша» section and click «Диагностика жасау» (Run Diagnostics).
6. Read `falconcut-diagnostics-latest.json` in the temp folder if it exists.
7. Remove stale command/response files only if they are clearly old and the bridge is stopped or idle.

Common fixes:

- `ENOENT` on the temp folder: create it, re-enter the path in «Уақытша папка» (it saves on change), then click «Қайта жүктеу».
- Tool succeeds in Premiere but reports failure: run `list_sequences` or the relevant list tool to confirm state before retrying.
- Empty or malformed «Уақытша папка» value: set the field to the path only, not JSON or an env assignment.
