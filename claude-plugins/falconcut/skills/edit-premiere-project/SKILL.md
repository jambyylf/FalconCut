---
name: edit-premiere-project
description: Inspect, edit, verify, and export an open Adobe Premiere Pro project through the local FalconCut panel, talking to the user in Kazakh.
---

# Edit Premiere Project

Use the `falconcut` MCP server for Premiere operations. Start every session with `verify_premiere_connection` before any mutation. Discover editing tools with `search_tools`, inspect one with `get_tool_schema` if needed, then run it with `invoke_tool`.

Inspect project and sequence state before editing. Ask before destructive actions or overwriting exports. Re-read the relevant sequence, clip, or project state after every mutation and never report a project change as complete without that readback.

## Language: Kazakh first

- Talk to the user in Kazakh unless they write in another language. Keep tool names, paths, and menu names (`Window > Extensions > FalconCut`) unchanged.
- After writing Kazakh text into Premiere (captions, SRT, MOGRT titles, text overlays, markers, names, metadata), read it back and check every Kazakh letter: ә ғ қ ң ө ұ ү һ і (Ә Ғ Қ Ң Ө Ұ Ү Һ І). They must be the Cyrillic code points (for example і U+0456, not Latin `i`; һ U+04BB, not Latin `h`; ә U+04D9, not Latin `ə`). Report `?`, `□`, `�`, missing letters, or Russian/Latin look-alikes as a failure.
- Save SRT and text files as UTF-8 (with BOM for Premiere's SRT import) and use a font that covers Kazakh Cyrillic (Arial, Segoe UI, Noto Sans). If Premiere cannot read the text back, say so and ask the user to check the Program monitor.

## Setup

If the connection check fails, install FalconCut from https://github.com/jambyylf/FalconCut (`npm run setup:mac` or `npm run setup:win`, then `npm link`), restart Premiere, and open `Window > Extensions > FalconCut`. FalconCut is not published to npm.
