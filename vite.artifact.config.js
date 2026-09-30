import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const shim = fileURLToPath(new URL('./src/lib/jsx-shim.js', import.meta.url));

// Single-file build for publishing as a claude.ai artifact: React comes from the
// cdnjs UMD globals (see scripts/build-artifact.mjs), everything else is inlined.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { 'react/jsx-runtime': shim, 'react/jsx-dev-runtime': shim } },
  build: {
    outDir: 'dist-artifact',
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: 'src/main.jsx',
      external: ['react', 'react-dom', 'react-dom/client'],
      output: {
        format: 'iife',
        entryFileNames: 'app.js',
        assetFileNames: 'app[extname]',
        globals: { react: 'React', 'react-dom': 'ReactDOM', 'react-dom/client': 'ReactDOM' },
      },
    },
  },
});
