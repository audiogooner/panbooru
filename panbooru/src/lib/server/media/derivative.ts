import sharp from 'sharp';

sharp.concurrency(1);
sharp.cache({ memory: 32, files: 0, items: 20 });

export const limitInputPixels = 16_777_216;
export const maxSourceBytes = 32 * 1024 * 1024;

export const recipeNames = {
	thumb: 'thumb-v1',
	display: 'display-v1',
	backdrop: 'backdrop-v1'
} as const;

export type RecipeName = (typeof recipeNames)[keyof typeof recipeNames];

const videoPath = /\.(mp4|webm|mkv|mov|m4v|ogv)$/i;

export function recipeFromQuery(value: string | null): RecipeName | null {
	if (value === 'thumb' || value === 'display' || value === 'backdrop') return recipeNames[value];
	return null;
}

export function isVideoFile(fileUrl: string) {
	try {
		return videoPath.test(new URL(fileUrl).pathname);
	} catch {
		return false;
	}
}

export type RenderedDerivative = {
	bytes: Buffer;
	width: number;
	height: number;
	format: 'webp';
	label: 'static-preview' | null;
};

export async function renderDerivative(
	input: Buffer,
	recipe: RecipeName
): Promise<RenderedDerivative> {
	const probed = await sharp(input, {
		limitInputPixels,
		sequentialRead: true,
		animated: true
	}).metadata();
	const animated = (probed.pages ?? 1) > 1;
	let pipeline = sharp(input, {
		limitInputPixels,
		sequentialRead: true,
		pages: 1,
		animated: false
	}).rotate();
	if (recipe === 'thumb-v1') {
		pipeline = pipeline.resize(320, 320, { fit: 'inside', withoutEnlargement: true });
	} else if (recipe === 'display-v1') {
		pipeline = pipeline.resize(1920, 1080, { fit: 'inside', withoutEnlargement: true });
	} else {
		pipeline = pipeline.resize(48, 48, { fit: 'inside', withoutEnlargement: true }).blur(6);
	}
	const rendered = await pipeline.webp({ quality: recipe === 'backdrop-v1' ? 40 : 75 }).toBuffer({
		resolveWithObject: true
	});
	return {
		bytes: rendered.data,
		width: rendered.info.width,
		height: rendered.info.height,
		format: 'webp',
		label: animated ? 'static-preview' : null
	};
}
