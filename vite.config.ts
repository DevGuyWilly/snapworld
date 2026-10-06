import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `npm run dev:phone` serves over HTTPS on the LAN so phones grant GPS + compass access.
export default defineConfig({
  plugins: process.env.HTTPS ? [basicSsl()] : [],
  worker: { format: 'es' },
});
