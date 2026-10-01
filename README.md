<div align="center">

# FalconCut

**Adobe Premiere Pro-ны AI арқылы қазақ тілінде басқаруға арналған MCP сервері.**

[![License: MIT](https://img.shields.io/badge/License-MIT-5fd3c6.svg)](LICENSE.md)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933.svg)](https://nodejs.org/)
[![Телеметрия](https://img.shields.io/badge/телеметрия-жоқ-2ea44f.svg)](PRIVACY.md)

**Тілдер:** Қазақша | [English](README.en.md)

</div>

## FalconCut деген не?

FalconCut — Claude Code, Claude Desktop, Codex сияқты AI көмекшілеріне Premiere Pro жобаңызбен жұмыс істеуге мүмкіндік беретін жергілікті бағдарлама. Сіз AI-ға қазақша «Белсенді секвенциядағы барлық кесілген жерге cross dissolve қой» деп жазасыз, ал ол Premiere ішінде нақты монтаж әрекеттерін орындайды.

- **286 Premiere құралы:** жоба, медиа импорты, секвенциялар, таймлайн монтажы, эффектілер, түс, аудио, субтитр, маркерлер, экспорт.
- **Екі камераны дыбыс бойынша синхрондау** (`sync_by_audio`): бірнеше нүктеде өлшеп, дрейф пен сенімділікті тексереді, содан кейін ғана жылжытады.
- **Байланған дыбыс пен сурет бірге жүреді:** клипті жылжытқанда, өшіргенде, қиғанда оның дыбысы да бірге өзгереді (`withLinked`, әдепкі мәні true).
- **Аралықты барлық тректен кесу** (`cut_range`): «00:00:22:03-ке дейінгісін кес» немесе «соңын кес» деген тапсырма бір командамен орындалады, камералар мен дыбыс ажырамайды. Секундпен де, таймкодпен де қабылдайды.
- **Үнсіз жерлерді кесу** (`cut_silences`): сөздегі үзілістерді тауып, барлық тректен бірге алып тастайды — синхрон бұзылмайды. Әдепкіде алдымен жоспарды көрсетеді және секвенцияның көшірмесімен жұмыс істейді.
- **Premiere ішіндегі FalconCut панелі** — қазақша (қаласаңыз, ағылшынша) интерфейс.
- **Қазақша көмекші:** агент сізбен қазақша сөйлеседі және субтитр мен титрлерде ә, ғ, қ, ң, ө, ұ, ү, һ, і әріптерінің дұрыс шыққанын тексереді.
- **Ешқандай телеметрия жоқ:** FalconCut желіге бірде-бір сұраныс жібермейді ([PRIVACY.md](PRIVACY.md)).

### Қалай жұмыс істейді

```text
+--------------+         +---------------+         +-------------------+
| AI клиенті   |   MCP   | FalconCut     | файлдар | FalconCut панелі  |
| (Claude,     |<------->| MCP сервері   |<------->| (Premiere ішінде) |
|  Codex ...)  |         | (Node.js)     |         |                   |
+--------------+         +---------------+         +-------------------+
                                                             |
                                                             v
                                                   +-------------------+
                                                   | Premiere Pro      |
                                                   +-------------------+
```

1. AI клиенті MCP құралын шақырады.
2. FalconCut сервері ExtendScript жазып, оны **уақытша папкаға** салады (macOS: `/tmp/falconcut-bridge`, Windows: `%TEMP%\falconcut-bridge`).
3. Premiere ішіндегі FalconCut панелі папканы бақылап, скриптті орындайды.
4. Нәтиже сол жолмен AI-ға қайтады.

## Не керек

- Adobe Premiere Pro 2020 немесе жаңарақ (2025 және 2026 нұсқаларында қолданылады)
- [Node.js](https://nodejs.org/) 20 немесе жаңарақ
- [Git](https://git-scm.com/)
- Premiere, AI клиенті және FalconCut **бір компьютерде** болуы керек

## Орнату — macOS

Terminal ашып, мына командаларды кезекпен орындаңыз:

```bash
git clone https://github.com/jambyylf/FalconCut.git
cd FalconCut
npm run setup:mac
npm link
falconcut-mcp --doctor
```

Не болады:

- `npm run setup:mac` — тәуелділіктерді орнатады, серверді жинайды, FalconCut панелін `~/Library/Application Support/Adobe/CEP/extensions/FalconCut` папкасына көшіреді, Adobe CEP debug режимін қосады, `/tmp/falconcut-bridge` папкасын жасайды және Claude Desktop баптауына `falconcut` жазбасын қосады.
- `npm link` — `falconcut-mcp` командасын жүйеге қосады (Claude Code-тың `.mcp.json` файлына осы команда керек).
- `falconcut-mcp --doctor` — бәрі дұрыс орнатылғанын тексереді.

Содан кейін Premiere Pro-ны қайта іске қосып, **Window > Extensions > FalconCut** мәзірін ашыңыз. Көпір өзі қосылады.

## Орнату — Windows

PowerShell ашып, мына командаларды кезекпен орындаңыз:

```powershell
git clone https://github.com/jambyylf/FalconCut.git
cd FalconCut
npm run setup:win
npm link
falconcut-mcp --doctor
```

Не болады:

- `npm run setup:win` — тәуелділіктерді орнатады, серверді жинайды, FalconCut панелін `%APPDATA%\Adobe\CEP\extensions\FalconCut` папкасына көшіреді, тізілімде (registry) Adobe CEP debug режимін қосады, `%TEMP%\falconcut-bridge` папкасын жасайды және VS Code (GitHub Copilot) мен Claude Desktop баптауларына `falconcut` жазбасын қосады.
- Ол клиенттер керек болмаса: `npm run setup:win -- -SkipCopilotConfig -SkipClaudeDesktopConfig`
- `npm link` — `falconcut-mcp` командасын жүйеге қосады.
- `falconcut-mcp --doctor` — орнатуды тексереді.

Содан кейін Premiere Pro-ны қайта іске қосып, **Window > Extensions > FalconCut** мәзірін ашыңыз.

## Claude Code-қа қосу (.mcp.json)

Жоба папкасының түбінде `.mcp.json` файлы бар:

```json
{
  "mcpServers": {
    "falconcut": {
      "command": "falconcut-mcp"
    }
  }
}
```

1. Алдымен `npm link` орындалғанына көз жеткізіңіз (`falconcut-mcp --version` нұсқаны көрсетуі керек).
2. Claude Code-ты осы папкада ашыңыз. Ол `.mcp.json`-ды тауып, `falconcut` серверін қосуға рұқсат сұрайды — **Yes** деп жауап беріңіз.
3. `/mcp` командасымен `falconcut` серверінің қосылғанын тексеріңіз.

**Басқа папкадан қолдану үшін** (мысалы, видео жобаларыңыз жатқан папкадан) серверді бүкіл жүйеге бір рет қосыңыз:

```bash
claude mcp add falconcut --scope user -- falconcut-mcp
```

**Windows ескертпесі:** `npm link` Windows-та `falconcut-mcp.cmd` файлын жасайды. Claude Code 2.1 оны тікелей іске қосады (Windows 11-де тексерілді). Ескі нұсқаларда `/mcp` ішінде `falconcut` қосылмаса, серверді былай қосыңыз:

```powershell
claude mcp add falconcut --scope user -- cmd /c falconcut-mcp
```

Уақытша папканы өзгерту қажет болса, `env` бөлімін қосыңыз (панельдегі «Уақытша папка» өрісі де дәл сондай болуы керек):

```json
"env": { "FALCONCUT_BRIDGE_DIR": "/басқа/жол" }
```

## Бірінші тексеріс

Premiere ашық, FalconCut панелі ашық тұрғанда AI-ға жазыңыз:

> verify_premiere_connection құралын іске қос. Жобаға ешқандай өзгеріс енгізбе.

Жауапта Premiere нұсқасы, ашық жоба және белсенді секвенция көрсетіледі. Бұл құрал тек оқиды — жобаны өзгертпейді.

Мысал сұраныстар:

- «Барлық секвенцияларды тізіп, қайсысы белсенді екенін айт.»
- «Мына үш файлды импорттап, қысқа жарнамалық ролик құрастыр.»
- «1-видеотректегі әр кесілген жерге cross dissolve қой.»
- «Сұхбат секвенциясын 12,5-секундта барлық тректер бойынша кес.»
- «Мына SRT файлынан қазақша субтитр трегін жаса да, әріптердің дұрыс шыққанын тексер.»

## Тіл

- **Панель:** төменгі **Қосымша** бөліміндегі **Тіл** тізімінен «Қазақша» немесе «English» таңдаңыз. Таңдау `~/.falconcut/config.json` файлына сақталады, CLI мен `--doctor` да соны қолданады.
- **CLI және `--doctor`:** бір рет ағылшынша көру үшін `FALCONCUT_LANG=en falconcut-mcp --doctor` (Windows PowerShell: `$env:FALCONCUT_LANG='en'; falconcut-mcp --doctor`).
- Барлық мәтін [`locales/kk.json`](locales/kk.json) және [`locales/en.json`](locales/en.json) файлдарында.
- MCP құралдарының аттары мен сипаттамалары әдейі ағылшынша қалдырылған — оларды адам емес, AI оқиды.

## Шектеулер

- Premiere-дің скрипт API-і интерфейстегі барлық әрекетті ашпайды — кейбір операциялар мүмкін емес, FalconCut ол туралы ашық айтады.
- Кәсіби титрлер нақты `.mogrt` (Motion Graphics) файлдарына тәуелді.
- Экспорт кезегі Adobe Media Encoder орнатылған кезде ғана жұмыс істейді.
- `sync_by_audio`, `cut_silences` және `detect_silence` құралдарына `ffmpeg` керек (`PATH` ішінде немесе `FALCONCUT_FFMPEG` арқылы). `--doctor` оны тексереді.
- FalconCut панелі қол қойылмаған (unsigned) CEP кеңейтпесі, сондықтан орнатушы Adobe CEP debug режимін қосады. Кей жағдайда Premiere-де **Settings > Plugins > Enable developer mode** белгісін қосу керек болуы мүмкін ([сурет](images/uxp-developer-mode.png)).
- `uxp-plugin/` — эксперименттік панель: орнатушы оны орнатпайды және ол қазақшаланбаған.
- Қазақша субтитр мен титрлер үшін кириллицаның қазақ әріптерін қолдайтын қаріп таңдаңыз (мысалы, Arial, Segoe UI, Noto Sans), әйтпесе әріптердің орнында бос төртбұрыш шығады.
- FalconCut npm-де жарияланбаған — тек осы репозиторийден `git clone` арқылы орнатылады.
- Premiere, AI клиенті және FalconCut бір компьютерде болуы керек.

## Ақаулар болса

1. `falconcut-mcp --doctor` іске қосыңыз — ол не жетіспейтінін қазақша айтады.
2. Premiere ашық па, жоба ашық па, **Window > Extensions > FalconCut** панелі ашық па — тексеріңіз.
3. Панельдегі «Уақытша папка» өрісі macOS-та `/tmp/falconcut-bridge`, Windows-та `%TEMP%\falconcut-bridge` болуы керек.
4. FalconCut жаңартылғаннан кейін панельдегі **Қайта жүктеу** батырмасын басыңыз.
5. Панельдің **Қосымша** бөліміндегі **Диагностика жасау** батырмасы уақытша папкаға `falconcut-diagnostics-latest.json` есебін жазады.

## Жаңарту

FalconCut түпнұсқа жобаның жаңартуларын `upstream` арқылы алады:

```bash
git fetch upstream
git merge upstream/main
npm install
npm run build
```

Содан кейін орнатушыны қайта іске қосып (`npm run setup:mac` немесе `npm run setup:win`), Premiere-дегі панельде **Қайта жүктеу** батырмасын басыңыз. Біріктіру (merge) кезінде қақтығыс шықса, AI көмекшіңізден көмек сұраңыз.

## Жою

- **macOS:** `npm run uninstall:mac`, содан кейін `npm unlink -g falconcut-mcp`.
- **Windows:** `%APPDATA%\Adobe\CEP\extensions\FalconCut` және `%TEMP%\falconcut-bridge` папкаларын өшіріп, Claude Desktop / VS Code баптауларынан `falconcut` жазбасын алып тастаңыз, содан кейін `npm unlink -g falconcut-mcp`.
- `~/.falconcut/` папкасында тек панель баптаулары бар; қажет болмаса, оны да өшіре аласыз.

## Әзірлеушілерге

```bash
npm install
npm run build
npm test
falconcut-mcp --doctor
```

Толығырақ: [QUICKSTART.md](QUICKSTART.md), [KNOWN_ISSUES.md](KNOWN_ISSUES.md), [CONTRIBUTING.md](CONTRIBUTING.md).

---

[hetpatel-11/Adobe_Premiere_Pro_MCP](https://github.com/hetpatel-11/Adobe_Premiere_Pro_MCP) негізінде жасалған. Лицензия: [MIT](LICENSE.md).
