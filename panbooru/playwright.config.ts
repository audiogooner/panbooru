import { defineConfig } from '@playwright/test';

export default defineConfig({
	webServer: { command: 'npm run build && node scripts/e2e-preview.mjs', port: 4173 },
	use: { baseURL: 'http://127.0.0.1:4173' },
	workers: 1,
	testMatch: '**/*.e2e.{ts,js}',
	projects: [
		{
			name: 'chromium',
			use: { browserName: 'chromium' },
			testIgnore: '**/a11y.e2e.ts'
		},
		{
			name: 'chromium-keyboard',
			use: { browserName: 'chromium' },
			testMatch: '**/a11y.e2e.ts',
			dependencies: ['chromium']
		},
		{
			name: 'firefox',
			use: { browserName: 'firefox' },
			testMatch: '**/a11y.e2e.ts',
			dependencies: ['chromium']
		}
	]
});
