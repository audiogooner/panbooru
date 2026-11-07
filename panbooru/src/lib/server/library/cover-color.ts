import sharp from 'sharp';

/** Outer band, as a fraction of each image edge, averaged into the border color. */
export const borderFraction = 0.08;

/** Chosen supports at or inside this Euclidean RGB distance freeze automatic updates. */
export const stopDistance = 30;

const limitInputPixels = 16_777_216;

export type Rgb = {
	r: number;
	g: number;
	b: number;
};

/** Image bytes, or a filesystem path Sharp can read. The caller names the primary. */
export type CoverColorCandidate = {
	id: string;
	image: Buffer | string;
};

export type CoverColorSupport = {
	id: string;
	distance: number;
};

export type CoverColorMatch = {
	supports: CoverColorSupport[];
	stopped: boolean;
};

export function rgbDistance(left: Rgb, right: Rgb): number {
	const red = left.r - right.r;
	const green = left.g - right.g;
	const blue = left.b - right.b;
	return Math.sqrt(red * red + green * green + blue * blue);
}

function borderInset(size: number): number {
	if (size <= 1) return size;
	const fraction = size * borderFraction;
	if (fraction < 1) return 1;
	return Math.min(size / 2, fraction);
}

function assertCandidate(candidate: CoverColorCandidate) {
	if (typeof candidate.id !== 'string' || candidate.id.length === 0) {
		throw new Error('Cover candidate is missing an id');
	}
	if (typeof candidate.image === 'string') {
		if (candidate.image.length === 0) throw new Error('Cover candidate is missing an image');
		return;
	}
	if (!Buffer.isBuffer(candidate.image) || candidate.image.length === 0) {
		throw new Error('Cover candidate is missing an image');
	}
}

function channel(value: number): number {
	return Math.min(255, Math.max(0, Math.round(value)));
}

export async function sampleBorderColor(image: Buffer | string): Promise<Rgb> {
	const { data, info } = await sharp(image, {
		limitInputPixels,
		sequentialRead: true,
		pages: 1,
		animated: false
	})
		.rotate()
		.toColourspace('srgb')
		.removeAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });

	const width = info.width;
	const height = info.height;
	const channels = info.channels;
	if (!width || !height || channels !== 3) {
		throw new Error('Cover image has no border to sample');
	}

	const insetX = borderInset(width);
	const insetY = borderInset(height);
	let red = 0;
	let green = 0;
	let blue = 0;
	let count = 0;
	for (let y = 0; y < height; y++) {
		const yEdge = y < insetY || y >= height - insetY;
		for (let x = 0; x < width; x++) {
			if (!yEdge && x >= insetX && x < width - insetX) continue;
			const offset = (y * width + x) * channels;
			red += data[offset] ?? 0;
			green += data[offset + 1] ?? 0;
			blue += data[offset + 2] ?? 0;
			count += 1;
		}
	}
	if (count === 0) throw new Error('Cover image has no border to sample');
	return {
		r: channel(red / count),
		g: channel(green / count),
		b: channel(blue / count)
	};
}

function distinctOthers(
	primary: CoverColorCandidate,
	candidates: readonly CoverColorCandidate[]
): CoverColorCandidate[] {
	const seen = new Set<string>([primary.id]);
	const others: CoverColorCandidate[] = [];
	for (const candidate of candidates) {
		assertCandidate(candidate);
		if (seen.has(candidate.id)) continue;
		seen.add(candidate.id);
		others.push(candidate);
	}
	return others;
}

/**
 * Primary is fixed by the caller. Supports are the other distinct images whose
 * border color is closest to it, at most three. Automatic updates stop when
 * every chosen support is within `stopDistance`, or when fewer than four
 * distinct images were supplied.
 */
export async function matchCoverColors(
	primary: CoverColorCandidate,
	candidates: readonly CoverColorCandidate[]
): Promise<CoverColorMatch> {
	assertCandidate(primary);
	const others = distinctOthers(primary, candidates);
	const primaryColor = await sampleBorderColor(primary.image);
	const scored: Array<{ id: string; distance: number; index: number }> = [];
	for (const [index, candidate] of others.entries()) {
		const color = await sampleBorderColor(candidate.image);
		scored.push({ id: candidate.id, distance: rgbDistance(primaryColor, color), index });
	}
	scored.sort((left, right) => left.distance - right.distance || left.index - right.index);
	const supports = scored.slice(0, 3).map(({ id, distance }) => ({ id, distance }));
	const distinct = others.length + 1;
	const withinStop =
		supports.length > 0 && supports.every((support) => support.distance <= stopDistance);
	return {
		supports,
		stopped: distinct < 4 || withinStop
	};
}
