import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `vite build` → static site with per-browser storage (GitHub Pages).
// `vite build --mode api` → site that talks to the Node server in server/ (Render).
// base './' keeps asset paths relative so the build works from any sub-path.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: { __BACKEND__: JSON.stringify(mode === 'api' ? 'api' : 'local') },
  base: './',
}));
