import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Modernes Ziel, das von aktuellen iPads (Safari) unterstützt wird
    target: 'es2020',
    chunkSizeWarningLimit: 1500,
  },
  worker: {
    format: 'es',
  },
});
