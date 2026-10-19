import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

const resolve = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [vue()],

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        popup: resolve('popup.html'),
        options: resolve('options.html'),
        panel: resolve('panel.html'),
        devtools: resolve('src/devtools/index.ts'),
      },
      output: {
        // The DevTools page script keeps a predictable path (no content hash)
        // so public/devtools.html can reference it statically.
        entryFileNames: (chunkInfo) =>
          chunkInfo.name === 'devtools' ? '[name].js' : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
