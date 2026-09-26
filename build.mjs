// Bundles the app into single self-contained HTML files:
//   dist/pixel-continent.html  — standalone page (open directly in a browser)
//   dist/artifact.html          — body fragment for hosting inside a page skeleton
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const title = 'Pixel Continent';
const fonts = 'https://fonts.googleapis.com/css2?family=Alegreya+Sans:ital,wght@0,400;0,500;0,700;1,400&family=IBM+Plex+Mono:wght@400;500&family=IM+Fell+English+SC&display=swap';
fs.mkdirSync('dist', { recursive: true });
execFileSync('npx', ['--yes', 'esbuild', 'src/main.js', '--bundle', '--format=iife', '--minify', '--target=es2020', '--outfile=dist/app.js', '--legal-comments=none'], { stdio: 'inherit' });
const js = fs.readFileSync('dist/app.js', 'utf8').replace(/<\/script/gi, '<\\/script');
const css = fs.readFileSync('src/ui/styles.css', 'utf8');
const head = `<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${fonts}">
<style>${css}</style>`;
const body = `<div id="app"></div>\n<script>${js}</script>`;
fs.writeFileSync('dist/artifact.html', `${head}\n${body}\n`);
fs.writeFileSync('dist/pixel-continent.html', `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${head}
</head>
<body>
${body}
</body>
</html>
`);
fs.rmSync('dist/app.js');
const kb = (f) => (fs.statSync(f).size / 1024).toFixed(0) + ' KB';
console.log('built dist/pixel-continent.html', kb('dist/pixel-continent.html'), '· dist/artifact.html', kb('dist/artifact.html'));
