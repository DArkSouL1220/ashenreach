// Bündelt dist/ zu einzelnen HTML-Dateien:
//  - dist-single/index.html   komplette Seite (file://-Tests, Verschicken, PWA ohne Server)
//  - dist-artifact/index.html nur Inhalt ohne <html>/<head>/<body> (für claude.ai-Artifacts)
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dist = new URL('../dist/', import.meta.url).pathname;
const single = new URL('../dist-single/', import.meta.url).pathname;
const artifact = new URL('../dist-artifact/', import.meta.url).pathname;
mkdirSync(single, { recursive: true });
mkdirSync(artifact, { recursive: true });

const src = readFileSync(join(dist, 'index.html'), 'utf8');
let js = '', css = '';
let html = src.replace(/<script type="module"[^>]*src="\.?\/?(assets\/[^"]+)"><\/script>/, (_, p) => {
  js = readFileSync(join(dist, p), 'utf8').replace(/<\/script>/g, '<\\/script>');
  return `<script type="module">\n${js}\n</script>`;
});
html = html.replace(/<link rel="stylesheet"[^>]*href="\.?\/?(assets\/[^"]+)">/, (_, p) => {
  css = readFileSync(join(dist, p), 'utf8');
  return `<style>\n${css}\n</style>`;
});
writeFileSync(join(single, 'index.html'), html);
for (const f of ['icon.png', 'manifest.webmanifest']) if (existsSync(join(dist, f))) copyFileSync(join(dist, f), join(single, f));

const body = (src.match(/<body>([\s\S]*?)<\/body>/)?.[1] ?? '').replace(/<script type="module"[^>]*><\/script>/, '').trim();
const title = src.match(/<title>(.*?)<\/title>/)?.[1] ?? 'Ashenreach';
const fragment = `<title>${title}</title>\n<style>\n${css}\n</style>\n${body}\n<script type="module">\n${js}\n</script>\n`;
writeFileSync(join(artifact, 'index.html'), fragment);
console.log('dist-single/index.html', (html.length / 1024).toFixed(0), 'kB · dist-artifact/index.html', (fragment.length / 1024).toFixed(0), 'kB');
