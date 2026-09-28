# Қауіпсіздік / Security

## Қазақша

FalconCut жергілікті жұмыс істейді және Premiere Pro жобаларын өзгерте алады. Бұл серверге қол жеткізе алатын MCP клиенті ашық тұрған жобаны өңдей алады деп есептеңіз.

- FalconCut панелін тек өзіңіз сенетін MCP клиенттерімен қолданыңыз.
- Монтаж алдында `verify_premiere_connection` іске қосып, ол көрсеткен жоба мен секвенцияның дұрыс екенін тексеріңіз.
- Premiere Pro, FalconCut панелі және MCP клиенті бір, сенімді компьютерде болуы керек.
- Қол қойылмаған CEP архивтерін белгісіз көздерден орнатпаңыз.
- FalconCut желіге ешқандай сұраныс жібермейді: телеметрия да, жаңарту тексерісі де жоқ ([PRIVACY.md](PRIVACY.md)).

Осалдық тапсаңыз, мәселені ашық issue-де жарияламай, осы репозиторийде GitHub security advisory ашыңыз.

## English

FalconCut runs locally and can change Premiere Pro projects. Treat any MCP client with access to this server as able to edit the open project.

- Use the FalconCut panel only with MCP clients you trust.
- Run `verify_premiere_connection` before an editing session and check the project and sequence it reports.
- Keep Premiere Pro, the FalconCut panel, and the MCP client on the same trusted machine.
- Do not install unsigned CEP archives from untrusted sources.
- FalconCut makes no network requests: no telemetry and no update checks ([PRIVACY.md](PRIVACY.md)).

To report a vulnerability privately, open a GitHub security advisory for this repository instead of publishing exploit details in an issue.
