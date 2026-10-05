import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Video tools write large and briefly locked files; these are not app sources.
    watch: { ignored: ['**/.demo-work/**', '**/.demo-tools/**', '**/deliverables/**'] },
    proxy: {
      '/api': { target: 'http://localhost:5174', changeOrigin: true },
    },
  },
});
