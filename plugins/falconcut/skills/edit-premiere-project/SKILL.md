---
name: edit-premiere-project
description: Install, verify, inspect, edit, and export local Adobe Premiere Pro projects through the FalconCut panel, talking to the user in Kazakh. Use for project discovery, timeline edits, media ingest, effects, Kazakh captions and titles, audio, and delivery exports.
---

# Edit Premiere Project

Operate Premiere through the `falconcut` MCP tools. Preserve the user's project state, make only requested changes, and verify each mutation with a follow-up read.

## Language: Kazakh first

- Talk to the user in Kazakh unless they write in another language. Keep tool names, paths, and menu names (`Window > Extensions > FalconCut`) unchanged.
- After writing Kazakh text into Premiere (captions, SRT, MOGRT titles, text overlays, markers, names, metadata), read it back and check every Kazakh letter: ә ғ қ ң ө ұ ү һ і (Ә Ғ Қ Ң Ө Ұ Ү Һ І). They must be the Cyrillic code points (for example і U+0456, not Latin `i`; һ U+04BB, not Latin `h`; ә U+04D9, not Latin `ə`). Report `?`, `□`, `�`, missing letters, or Russian/Latin look-alikes as a failure.
- Save SRT and text files as UTF-8 (with BOM for Premiere's SRT import) and use a font that covers Kazakh Cyrillic (Arial, Segoe UI, Noto Sans). If Premiere cannot read the text back, say so and ask the user to check the Program monitor.

## Establish A Live Session

1. Call `verify_premiere_connection` before editing. If it fails, stop and ask the user (in Kazakh) to open `Window > Extensions > FalconCut` in Premiere.
2. Discover editing tools with `search_tools` (BM25 query or regex pattern), then `invoke_tool`. `get_capabilities` reports catalog.advertised vs catalog.tools.
3. Inspect the active project, sequence, tracks, and media before making an edit.

## Editing Rules

- Prefer read-only discovery before changing the project.
- Use real imported media and concrete project item and sequence IDs.
- Ask before deleting clips, tracks, sequences, media, overwriting exports, or saving over an important project.
- For generated edits, create a clearly named sequence instead of modifying the active sequence when practical.
- Treat any `success: false` result as a stop condition. Run diagnostics or re-inspect state before retrying.
- Verify an edit with the narrowest relevant read tool before reporting it complete.

## Setup And Recovery

Install FalconCut on the same computer as Premiere and the AI client (it is not published to npm):

```bash
git clone https://github.com/jambyylf/FalconCut.git
cd FalconCut
npm run setup:mac   # or: npm run setup:win
npm link
falconcut-mcp --doctor
```

Restart Premiere Pro, open `Window > Extensions > FalconCut` (the bridge starts by itself), then run `verify_premiere_connection`.
