import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// One self-contained index.html (JS, CSS and fonts inlined) — for hosting/sharing as a single file.
export default defineConfig({
  plugins: [viteSingleFile()],
  build: { outDir: 'dist-single', target: 'es2022', assetsInlineLimit: 100000000, chunkSizeWarningLimit: 4000 },
});
