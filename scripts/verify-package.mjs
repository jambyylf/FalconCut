import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const requiredPaths = [
  'dist/index.js',
  'dist/cli.js',
  'cep-plugin/CSXS/manifest.xml',
  'cep-plugin/bridge-cep.js',
  'locales/kk.json',
  'locales/en.json',
  'scripts/i18n.cjs',
  'scripts/i18n.sh',
  'scripts/i18n.ps1',
  'scripts/install-macos.sh',
  'scripts/install-windows.ps1',
  'scripts/doctor-macos.sh',
  'scripts/doctor-windows.ps1',
  'README.md',
  'LICENSE.md',
];

const { stdout } = await execFileAsync('npm', ['pack', '--dry-run', '--json'], { maxBuffer: 1024 * 1024 });
const [pack] = JSON.parse(stdout);
const packagedPaths = new Set(pack.files.map((file) => file.path));
const missing = requiredPaths.filter((path) => !packagedPaths.has(path));

if (missing.length > 0) {
  console.error(`npm package is missing required files: ${missing.join(', ')}`);
  process.exit(1);
}

console.log(`npm package verified: ${pack.name}@${pack.version} (${pack.files.length} files)`);
