# Жылдам бастау

Жұмыс істейтін орнатудың ең қысқа жолы. Толық сипаттама — [README.md](README.md).

## macOS (Claude Desktop / Claude Code)

```bash
git clone https://github.com/jambyylf/FalconCut.git
cd FalconCut
npm run setup:mac
npm link
falconcut-mcp --doctor
```

Содан кейін Premiere Pro ішінде бір рет:

1. Premiere Pro-ны қайта іске қосыңыз.
2. **Window > Extensions > FalconCut** мәзірін ашыңыз. Көпір өзі қосылады.
3. «Уақытша папка» өрісінде `/tmp/falconcut-bridge` тұрғанын тексеріңіз.
4. Панель көрінбесе: **Premiere Pro > Settings > Plugins** ішінде **Enable developer mode** белгісін қосып, Premiere-ді қайта іске қосыңыз.

   ![Premiere Pro-да developer mode қосу](images/uxp-developer-mode.png)

5. Ақау болса, панельдің **Қосымша** бөліміндегі **Диагностика жасау** батырмасын басыңыз — есеп `/tmp/falconcut-bridge/falconcut-diagnostics-latest.json` файлына жазылады.

Содан кейін Claude-ты қайта іске қосып, сұраңыз:

```text
verify_premiere_connection құралын іске қос. Жобаға ешқандай өзгеріс енгізбе.
```

## Windows (Claude Code / Claude Desktop / GitHub Copilot)

```powershell
git clone https://github.com/jambyylf/FalconCut.git
cd FalconCut
npm run setup:win
npm link
falconcut-mcp --doctor
```

Содан кейін Premiere Pro ішінде бір рет:

1. Premiere Pro-ны қайта іске қосыңыз.
2. **Window > Extensions > FalconCut** мәзірін ашыңыз.
3. «Уақытша папка» өрісінде `%TEMP%\falconcut-bridge` жолы (мысалы, `C:\Users\<атыңыз>\AppData\Local\Temp\falconcut-bridge`) тұрғанын тексеріңіз.

Windows орнатушысы VS Code (GitHub Copilot) мен Claude Desktop баптауларына `falconcut` жазбасын қосады. Оларды қоспау үшін: `npm run setup:win -- -SkipCopilotConfig -SkipClaudeDesktopConfig`.

## Claude Code

Репозиторий түбіндегі `.mcp.json` серверді `falconcut-mcp` командасымен қосады. Claude Code-ты осы папкада ашып, `falconcut` серверін қосуға рұқсат беріңіз, содан кейін `/mcp` арқылы тексеріңіз.

Кез келген папкадан қолдану үшін:

```bash
claude mcp add falconcut --scope user -- falconcut-mcp
```

Windows-та `falconcut` қосылмаса: `claude mcp add falconcut --scope user -- cmd /c falconcut-mcp`.

## Codex

```bash
codex mcp add falconcut -- falconcut-mcp
```

## Тексерістер

```bash
falconcut-mcp --doctor
```

`--doctor` Node.js-ті, сервер жинағын, FalconCut панелін, уақытша папканы, Adobe CEP debug режимін, MCP клиент баптауларын және панельдің қазір Premiere-де жұмыс істеп тұрғанын тексереді. Ағылшынша нәтиже үшін: `FALCONCUT_LANG=en falconcut-mcp --doctor`.

Нақты Premiere-мен толық тексеріс үшін (жаңа, бос жобада):

```bash
node scripts/live-tool-sweep.mjs
```

Бұл скрипт жобада `Sweep ...` деген уақытша секвенциялар жасайды.

## Жиі кездесетін ақаулар

### AI клиенті серверді көреді, бірақ құралдар жұмыс істемейді

- Premiere ашылмаған
- жоба ашылмаған
- FalconCut панелі ашылмаған немесе көпір тоқтатылған
- панельдегі «Уақытша папка» MCP клиентіндегі жолмен сәйкес емес
- FalconCut жаңартылғаннан кейін панельдегі **Қайта жүктеу** батырмасын басу керек

### Claude Code-та `falconcut` қосылмайды

- `npm link` орындалмаған (`falconcut-mcp --version` тексеріңіз)
- Windows-та `cmd /c` нұсқасын қолданыңыз (жоғарыдан қараңыз)
- баптауды өзгерткеннен кейін Claude Code қайта іске қосылмаған

### `--doctor` ақау көрсетеді

- FalconCut панелі орнатылмаған → `falconcut-mcp --install-cep`
- `dist/index.js` жоқ → `npm run build`
- Adobe CEP debug режимі өшірулі → орнатушыны қайта іске қосыңыз

Телеметрия жоқ: FalconCut желіге ешқандай сұраныс жібермейді ([PRIVACY.md](PRIVACY.md)).
