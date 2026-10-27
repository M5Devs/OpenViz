import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
  if (mode === 'cli') {
    return {
      build: {
        outDir: 'dist/cli',
        lib: {
          entry: resolve(__dirname, 'src/cli/index.ts'),
          formats: ['es'],
          fileName: 'index',
        },
        rollupOptions: {
          external: [
            'commander',
            'jszip',
            'fs',
            'path',
            'child_process',
            'url',
            'util',
            'os'
          ],
        },
        target: 'node18',
        emptyOutDir: true,
      },
    };
  }

  return {
    server: {
      port: 3000,
      host: true,
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
      emptyOutDir: false,
    },
  };
});
