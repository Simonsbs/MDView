import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['src/renderer.js'],
  outfile: 'dist/renderer.js',
  bundle: true,
  minify: true,
  platform: 'browser',
  target: 'chrome144',
  legalComments: 'eof',
});
await Promise.all(['index.html', 'styles.css'].map(file => copyFile(`src/${file}`, `dist/${file}`)));
