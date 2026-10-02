import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base: './'` keeps every asset URL relative, so the same build works at a
// GitHub Pages project subpath (https://user.github.io/repo/) or at a root
// domain. Routing uses the URL hash, so nested routes never hit the server.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true,
    // One chunk by design (about 0.5 MB: React, the score reader, the app and
    // the catalog), loaded once and then cached; warn only if it grows well past that.
    chunkSizeWarningLimit: 650,
  },
});
