import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createMediaRegistry, memoryMediaRegistry } from '#lib/server/media/refs.ts';

const directories: string[] = [];

afterEach(async () => {
	await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('media refs', () => {
	it('resolves sealed refs after a fresh registry shares the same key', async () => {
		const dataDir = await mkdtemp(join(tmpdir(), 'panbooru-media-refs-'));
		directories.push(dataDir);
		const secretPath = join(dataDir, 'secrets', 'master.key');
		const first = createMediaRegistry({ dataDir, secretPath });
		const ref = first.put({
			fileUrl: 'https://img.example/a.jpg',
			previewUrl: 'https://img.example/a.preview.jpg'
		});
		expect(ref.startsWith('http')).toBe(false);
		expect(ref.includes('/')).toBe(false);

		const second = createMediaRegistry({ dataDir, secretPath });
		expect(second.get(ref)).toEqual({
			fileUrl: 'https://img.example/a.jpg',
			previewUrl: 'https://img.example/a.preview.jpg'
		});
		expect(second.get('not-a-ref')).toBeUndefined();
		expect(second.get(ref.slice(0, 8))).toBeUndefined();
	});

	it('keeps memory refs process-local', () => {
		const media = memoryMediaRegistry();
		const ref = media.put({
			fileUrl: 'https://img.example/b.jpg',
			previewUrl: 'https://img.example/b.jpg'
		});
		expect(media.get(ref)?.fileUrl).toBe('https://img.example/b.jpg');
		expect(memoryMediaRegistry().get(ref)).toBeUndefined();
	});
});
