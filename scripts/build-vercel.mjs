// Builds a Vercel Build Output API v3 bundle in .vercel/output:
//   static/                 → the Vite client
//   functions/api.func/     → server/vercel.ts bundled into one file + historical dataset
// Used as the Vercel build command; also runnable locally to inspect what ships.
import { build } from 'esbuild';
import { execSync } from 'child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.vercel', 'output');
const funcDir = path.join(out, 'functions', 'api.func');

rmSync(out, { recursive: true, force: true });

// ── Client ────────────────────────────────────────────────────────────────────
execSync('npm run build', { cwd: path.join(root, 'client'), stdio: 'inherit' });
cpSync(path.join(root, 'client', 'dist'), path.join(out, 'static'), { recursive: true });

// ── API function ──────────────────────────────────────────────────────────────
mkdirSync(path.join(funcDir, 'data'), { recursive: true });
await build({
  entryPoints: [path.join(root, 'server', 'vercel.ts')],
  outfile: path.join(funcDir, 'index.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  // Export the handler itself rather than { default: handler }.
  footer: { js: 'module.exports = module.exports.default;' },
  logLevel: 'warning',
});
cpSync(
  path.join(root, 'server', 'data', 'training_dataset_historical.json'),
  path.join(funcDir, 'data', 'training_dataset_historical.json')
);
writeFileSync(path.join(funcDir, '.vc-config.json'), JSON.stringify({
  runtime: 'nodejs22.x',
  handler: 'index.js',
  launcherType: 'Nodejs',
  shouldAddHelpers: false,
  maxDuration: 60,
}, null, 2));

// ── Routing ───────────────────────────────────────────────────────────────────
writeFileSync(path.join(out, 'config.json'), JSON.stringify({
  version: 3,
  routes: [
    { src: '^/api/(.*)$', dest: '/api?__nr1path=$1' },
    { handle: 'filesystem' },
    { src: '^/(.*)$', dest: '/index.html' },
  ],
}, null, 2));

console.log(`Vercel output written to ${path.relative(root, out)}`);
