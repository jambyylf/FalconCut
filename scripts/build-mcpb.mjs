import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const outputDirectory = join(root, 'release-artifacts');
const stagingDirectory = join(root, '.mcpb-staging');
const serverDirectory = join(stagingDirectory, 'server');
const outputPath = join(outputDirectory, `falconcut-mcp-${packageJson.version}.mcpb`);

const manifest = {
  manifest_version: '0.3',
  name: 'falconcut-mcp',
  display_name: 'FalconCut',
  version: packageJson.version,
  description: 'Control Adobe Premiere Pro through MCP using the included FalconCut CEP panel.',
  long_description: 'A local MCP server for Adobe Premiere Pro. On first launch the bundle installs its FalconCut CEP panel for the current user. Restart Premiere Pro, open Window > Extensions > FalconCut, and the bridge starts by itself before you request edits.',
  author: {
    name: 'Zhambyl Bakytkeldi',
    url: 'https://github.com/jambyylf/FalconCut'
  },
  repository: {
    type: 'git',
    url: 'https://github.com/jambyylf/FalconCut.git'
  },
  documentation: 'https://github.com/jambyylf/FalconCut#readme',
  support: 'https://github.com/jambyylf/FalconCut/issues',
  server: {
    type: 'node',
    entry_point: 'server/launcher.js',
    mcp_config: {
      command: 'node',
      args: ['${__dirname}/server/launcher.js']
    }
  },
  tools_generated: true,
  keywords: ['adobe', 'premiere-pro', 'video-editing', 'mcp', 'ai'],
  license: 'MIT',
  compatibility: {
    platforms: ['darwin', 'win32'],
    runtimes: { node: '>=20.0.0' }
  }
};

const launcher = `import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const root = dirname(fileURLToPath(import.meta.url));
const bridgeSource = join(root, 'cep-plugin');
// CEP панелі де дәл осы жолды қолданады: macOS-та /tmp, Windows-та %TEMP%
const tempDirectory = process.env.FALCONCUT_BRIDGE_DIR || join(process.platform === 'win32' ? tmpdir() : '/tmp', 'falconcut-bridge');

function installCepBridge() {
  let target;
  if (process.platform === 'darwin') {
    target = join(homedir(), 'Library', 'Application Support', 'Adobe', 'CEP', 'extensions', 'FalconCut');
    for (let version = 9; version <= 15; version += 1) {
      spawnSync('defaults', ['write', 'com.adobe.CSXS.' + version, 'PlayerDebugMode', '-bool', 'true'], { stdio: 'ignore' });
    }
  } else if (process.platform === 'win32') {
    target = join(process.env.APPDATA || homedir(), 'Adobe', 'CEP', 'extensions', 'FalconCut');
    for (let version = 9; version <= 15; version += 1) {
      spawnSync('reg.exe', ['add', 'HKCU\\\\Software\\\\Adobe\\\\CSXS.' + version, '/v', 'PlayerDebugMode', '/t', 'REG_SZ', '/d', '1', '/f'], { stdio: 'ignore' });
    }
  } else {
    throw new Error('FalconCut supports macOS and Windows only.');
  }

  if (!existsSync(bridgeSource)) throw new Error('The bundled FalconCut CEP panel is missing. Reinstall the MCP bundle.');
  cpSync(bridgeSource, target, { recursive: true, force: true });
  mkdirSync(tempDirectory, { recursive: true });
}

try {
  installCepBridge();
} catch (error) {
  process.stderr.write('FalconCut setup failed: ' + (error instanceof Error ? error.message : String(error)) + '\\n');
  process.exit(1);
}

const server = spawn(process.execPath, [join(root, 'dist', 'index.js')], {
  stdio: 'inherit',
  env: { ...process.env, FALCONCUT_BRIDGE_DIR: tempDirectory }
});
server.on('error', (error) => {
  process.stderr.write('FalconCut failed to start: ' + error.message + '\\n');
  process.exit(1);
});
server.on('exit', (code) => process.exit(code ?? 1));
`;

await rm(stagingDirectory, { recursive: true, force: true });
await mkdir(serverDirectory, { recursive: true });
await cp(join(root, 'dist'), join(serverDirectory, 'dist'), { recursive: true });
await cp(join(root, 'cep-plugin'), join(serverDirectory, 'cep-plugin'), { recursive: true });
await cp(join(root, 'package.json'), join(serverDirectory, 'package.json'));
await cp(join(root, 'package-lock.json'), join(serverDirectory, 'package-lock.json'));
await writeFile(join(serverDirectory, 'launcher.js'), launcher);
await writeFile(join(stagingDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

await execFileAsync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--prefix', serverDirectory], {
  cwd: root,
  maxBuffer: 1024 * 1024
});
await mkdir(outputDirectory, { recursive: true });
await execFileAsync('npx', ['mcpb', 'validate', stagingDirectory], { cwd: root, maxBuffer: 1024 * 1024 });
await execFileAsync('npx', ['mcpb', 'pack', stagingDirectory, outputPath], { cwd: root, maxBuffer: 1024 * 1024 });
await execFileAsync('npx', ['mcpb', 'info', outputPath], { cwd: root, maxBuffer: 1024 * 1024 });

console.log(`MCPB bundle created: ${outputPath}`);
