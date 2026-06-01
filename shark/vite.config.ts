import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Base path: Catalyst Web Client Hosting sirve el SPA bajo /app/ (no raíz).
// Sin esto, los assets se piden a /assets/... (root) y dan 404.
// Si algún día se monta en otra ruta, cambiarlo acá.
export default defineConfig({
  base: '/app/',
  plugins: [react()],
  server: {
    port: 3000,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
