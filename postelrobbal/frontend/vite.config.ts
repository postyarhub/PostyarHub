import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Static SPA (ADR-0001): deployed at the web root (public_html), no server
// runtime. Base MUST be '/' — with './' the bundle URLs in index.html become
// document-relative and break at nested routes (e.g. /dashboard/posts/new
// resolved assets to /dashboard/posts/assets/*). Absolute paths work at any
// depth; shared-hosting .htaccess maps /api,/health to the Node app and
// deep-links to index.html. Hashed assets + no source maps in production (§175).
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    sourcemap: false,
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
        },
      },
    },
  },
});
