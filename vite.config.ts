import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `npm run dev:phone` serves over HTTPS on the LAN so phones grant GPS + compass access.
// GitHub Pages serves the site from /<repo>/, so builds there set BASE_PATH.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: process.env.HTTPS ? [basicSsl()] : [],
  worker: { format: 'es' },
});
