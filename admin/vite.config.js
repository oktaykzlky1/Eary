import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'admin',
  plugins: [react()],
  build: {
    outDir: '../admin-dist',
    emptyOutDir: true
  }
});
