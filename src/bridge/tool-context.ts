/**
 * FalconCut: қазір орындалып жатқан MCP құралының атын bridge-ге жеткізу.
 *
 * Сервер әр tools/call (және resources/read) сұранысын runWithToolName ішінде
 * орындайды, ал bridge команда файлына "tool" өрісін қосады. Premiere-дегі
 * панель оны тек «Соңғы команда» бөлімінде көрсету үшін оқиды — команданы
 * орындау тәртібіне ешқандай әсері жоқ. AsyncLocalStorage мәнді await арқылы
 * өтетін барлық шақыруларға өздігінен жеткізеді, сондықтан әр құралдың
 * қолтаңбасын өзгертудің қажеті жоқ.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

const currentTool = new AsyncLocalStorage<string>();

export function runWithToolName<T>(tool: string, fn: () => T): T {
  return currentTool.run(tool, fn);
}

export function currentToolName(): string | undefined {
  return currentTool.getStore();
}
