import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        newtab: resolve(__dirname, 'newtab.html'),
      },
    },
  },
})
