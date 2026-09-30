// Builds dist-artifact/p1-dashboard.html: one self-contained page for the claude.ai Artifact viewer.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

execSync('npx vite build --config vite.artifact.config.js', { stdio: 'inherit' });

const css = readFileSync('dist-artifact/app.css', 'utf8');
const js = readFileSync('dist-artifact/app.js', 'utf8').replace(/<\/script/gi, '<\\/script');
const CDN = 'https://cdnjs.cloudflare.com/ajax/libs';

const html = `<title>TOP5 Maintenance Dashboard PP561011</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Kanit:wght@400;500;600;700&family=Anuphan:wght@400;500;600;700&display=swap">
<style>
${css}
</style>
<div id="root"></div>
<script src="${CDN}/react/18.3.1/umd/react.production.min.js"></script>
<script src="${CDN}/react-dom/18.3.1/umd/react-dom.production.min.js"></script>
<script>
${js}
</script>
`;
writeFileSync('dist-artifact/p1-dashboard.html', html);
console.log(`dist-artifact/p1-dashboard.html ${(html.length / 1024).toFixed(1)} KB`);
