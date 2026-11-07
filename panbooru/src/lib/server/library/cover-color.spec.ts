import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
	matchCoverColors,
	sampleBorderColor,
	type CoverColorCandidate,
	type Rgb
} from '#lib/server/library/cover-color.ts';

async function solid(color: Rgb, width = 50, height = 40): Promise<Buffer> {
	return sharp({
		create: { width, height, channels: 3, background: color }
	})
		.png()
		.toBuffer();
}

async function candidate(id: string, color: Rgb): Promise<CoverColorCandidate> {
	return { id, image: await solid(color) };
}

describe('automatic cover colors', () => {
	it('picks the three supports closest in border color', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'panbooru-cover-color-'));
		try {
			const nearPath = join(directory, 'near.png');
			await writeFile(nearPath, await solid({ r: 18, g: 0, b: 0 }));
			const primary = await candidate('primary', { r: 0, g: 0, b: 0 });
			const result = await matchCoverColors(primary, [
				{ id: 'near', image: nearPath },
				await candidate('edge', { r: 18, g: 24, b: 0 }),
				await candidate('wide', { r: 40, g: 0, b: 0 }),
				await candidate('far', { r: 0, g: 80, b: 0 }),
				await candidate('farther', { r: 0, g: 0, b: 200 }),
				{ id: 'primary', image: await solid({ r: 0, g: 0, b: 1 }) }
			]);

			expect(result.supports).toEqual([
				{ id: 'near', distance: 18 },
				{ id: 'edge', distance: 30 },
				{ id: 'wide', distance: 40 }
			]);
			expect(result.stopped).toBe(false);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it('stops when every chosen support is within distance 30', async () => {
		const primary = await candidate('primary', { r: 0, g: 0, b: 0 });
		const result = await matchCoverColors(primary, [
			await candidate('east', { r: 30, g: 0, b: 0 }),
			await candidate('south', { r: 0, g: 30, b: 0 }),
			await candidate('diagonal', { r: 18, g: 24, b: 0 }),
			await candidate('outlier', { r: 90, g: 0, b: 0 })
		]);

		expect(result.supports).toEqual([
			{ id: 'east', distance: 30 },
			{ id: 'south', distance: 30 },
			{ id: 'diagonal', distance: 30 }
		]);
		expect(result.stopped).toBe(true);
	});

	it('stops when fewer than four distinct images exist', async () => {
		const primary = await candidate('primary', { r: 0, g: 0, b: 0 });
		const result = await matchCoverColors(primary, [
			{ id: 'primary', image: await solid({ r: 0, g: 0, b: 1 }) },
			await candidate('mid', { r: 0, g: 55, b: 0 }),
			await candidate('far', { r: 80, g: 0, b: 0 })
		]);

		expect(result.supports).toEqual([
			{ id: 'mid', distance: 55 },
			{ id: 'far', distance: 80 }
		]);
		expect(result.stopped).toBe(true);

		const alone = await matchCoverColors(primary, []);
		expect(alone.supports).toEqual([]);
		expect(alone.stopped).toBe(true);
	});

	it('averages the outer 8 percent and ignores the center', async () => {
		const width = 100;
		const height = 50;
		const border = { r: 8, g: 16, b: 24 };
		const center = { r: 200, g: 10, b: 10 };
		const bandX = Math.floor(width * 0.08);
		const bandY = Math.floor(height * 0.08);
		const raw = Buffer.alloc(width * height * 3);
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const edge = x < bandX || x >= width - bandX || y < bandY || y >= height - bandY;
				const color = edge ? border : center;
				const offset = (y * width + x) * 3;
				raw[offset] = color.r;
				raw[offset + 1] = color.g;
				raw[offset + 2] = color.b;
			}
		}
		const framed = await sharp(raw, { raw: { width, height, channels: 3 } })
			.png()
			.toBuffer();

		expect(bandX).toBe(8);
		expect(bandY).toBe(4);
		expect(await sampleBorderColor(framed)).toEqual(border);

		const primary = await candidate('primary', border);
		const result = await matchCoverColors(primary, [
			{ id: 'framed', image: framed },
			await candidate('center', center)
		]);
		expect(result.supports[0]).toEqual({ id: 'framed', distance: 0 });
	});
});
