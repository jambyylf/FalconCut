/**
 * FalconCut брендіне қатысты барлық атаулар осы файлда.
 *
 * Әр атау түпнұсқа hetpatel-11/Adobe_Premiere_Pro_MCP атауларынан бөлек, сондықтан
 * екі плагин бір компьютерде қатар орнатылса да бір-бірінің папкасына,
 * баптауына немесе командаларына араласпайды.
 */

import { normalize } from 'node:path';

/** Қолданушыға көрінетін атау. */
export const BRAND_NAME = 'FalconCut';

/** npm пакеті мен CLI командасының атауы. */
export const PACKAGE_NAME = 'falconcut-mcp';
export const CLI_NAME = 'falconcut-mcp';

/** MCP клиентіне (Claude, Codex) берілетін сервер атауы. */
export const MCP_SERVER_NAME = 'falconcut';

/** Adobe CEP extensions ішіндегі панель папкасы. */
export const CEP_FOLDER_NAME = 'FalconCut';

/** Сервер мен Premiere панелі командаларды алмасатын ортақ папка атауы. */
export const BRIDGE_DIR_NAME = 'falconcut-bridge';

/** Үй папкасындағы баптаулар папкасы: ~/.falconcut/ */
export const CONFIG_DIR_NAME = '.falconcut';

/** Орта айнымалылары. */
export const BRIDGE_DIR_ENV = 'FALCONCUT_BRIDGE_DIR';
export const TOOLSET_ENV = 'FALCONCUT_TOOLSET';
export const LANG_ENV = 'FALCONCUT_LANG';

/**
 * Әдепкі көпір папкасы: macOS-та /tmp/falconcut-bridge, Windows-та
 * %TEMP%\falconcut-bridge. CEP панелі де дәл осы жолды қолданады
 * (cep-plugin/bridge-cep.js → getDefaultTempPath), сондықтан MCP клиентінде
 * FALCONCUT_BRIDGE_DIR берілмесе де екі жақ бір папкада кездеседі.
 */
export function defaultBridgeDir(
  platform: string = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const base = platform === 'win32' ? env.TEMP || env.TMP || 'C:\\Temp' : '/tmp';
  return normalize(`${base}/${BRIDGE_DIR_NAME}`);
}

/** Қазір қолданылатын көпір папкасы: алдымен FALCONCUT_BRIDGE_DIR, болмаса әдепкі жол. */
export function bridgeDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[BRIDGE_DIR_ENV];
  return configured ? configured.replace(/[\\/]+$/, '') : defaultBridgeDir(process.platform, env);
}
