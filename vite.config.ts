import { defineConfig } from 'vite';

const api = 'http://127.0.0.1:4098';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    // changeOrigin rewrites Host for the API; Origin must match it to pass the same-origin check.
    proxy: { '/api': { target: api, changeOrigin: true, headers: { origin: api } } },
  },
});
