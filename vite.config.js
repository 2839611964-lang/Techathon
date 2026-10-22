import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { localApi } from './dev-api.js';
import { resolve } from 'node:path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  for (const key of [
    'OPENAI_API_KEY', 'OPENAI_TEXT_MODEL', 'OPENAI_VISION_MODEL', 'OPENAI_REALTIME_MODEL',
    'VOLCENGINE_API_KEY', 'VOLCENGINE_APP_ID', 'VOLCENGINE_ACCESS_KEY', 'VOLCENGINE_REALTIME_MODEL',
    'VOLCENGINE_REALTIME_SPEAKER', 'VOLCENGINE_REALTIME_SPEECH_RATE',
  ]) {
    if (env[key] && !process.env[key]) process.env[key] = env[key];
  }
  return {
    plugins: [react(), localApi()],
    build: { rollupOptions: { input: { welcome: resolve('index.html'), app: resolve('app.html') } } },
    server: { port: 4173, host: '127.0.0.1' },
  };
});
