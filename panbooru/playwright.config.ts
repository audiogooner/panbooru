import { defineConfig } from '@playwright/test';

export default defineConfig({
	webServer: { command: 'npm run build && node scripts/e2e-preview.mjs', port: 4173 },
	use: { baseURL: 'http://127.0.0.1:4173' },
	workers: 1,
	testMatch: '**/*.e2e.{ts,js}'
});
