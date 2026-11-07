import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadDotEnv } from '#lib/server/app.ts';

describe('loadDotEnv', () => {
	const previous = process.env.PANBOORU_DATA_DIR;
	let directory = '';

	afterEach(() => {
		if (previous === undefined) delete process.env.PANBOORU_DATA_DIR;
		else process.env.PANBOORU_DATA_DIR = previous;
		if (directory) rmSync(directory, { recursive: true, force: true });
	});

	it('reads a gitignored env file without replacing variables already set', () => {
		directory = mkdtempSync(join(tmpdir(), 'panbooru-dotenv-'));
		const path = join(directory, '.env');
		writeFileSync(path, 'PANBOORU_DATA_DIR=./data\n');
		delete process.env.PANBOORU_DATA_DIR;
		loadDotEnv(path);
		expect(process.env.PANBOORU_DATA_DIR).toBe('./data');

		process.env.PANBOORU_DATA_DIR = 'explicit';
		writeFileSync(path, 'PANBOORU_DATA_DIR=./other\n');
		loadDotEnv(path);
		expect(process.env.PANBOORU_DATA_DIR).toBe('explicit');
		loadDotEnv(join(directory, 'missing.env'));
	});
});
