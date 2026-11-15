#!/usr/bin/env node
/**
 * Rebuild src/lib/icons/paths.ts from @mynaui/icons stroke SVGs.
 * Keeps Panbooru semantic names; maps them to Myna filenames below.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '../node_modules/@mynaui/icons/icons');
const outFile = path.join(__dirname, '../src/lib/icons/paths.ts');

/** @type {Record<string, string>} */
const map = {
	search: 'search',
	'book-image': 'book-image',
	heart: 'heart',
	plus: 'plus',
	x: 'x',
	sort: 'sort',
	up: 'arrow-up',
	shuffle: 'shuffle',
	star: 'star',
	rating: 'shield-check',
	image: 'image',
	film: 'film',
	play: 'play',
	animate: 'layers-two',
	settings: 'cog',
	sliders: 'config',
	external: 'external-link',
	download: 'download',
	full: 'maximize',
	panel: 'panel-right',
	left: 'chevron-left',
	right: 'chevron-right',
	pin: 'pin',
	saved: 'bookmark',
	artist: 'pencil',
	character: 'user',
	check: 'check',
	trash: 'trash'
};

const names = Object.keys(map);

/** @param {string} svg */
function pathDs(svg) {
	const matches = [...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)];
	if (matches.length === 0) {
		throw new Error('no path elements found');
	}
	return matches.map((m) => m[1]);
}

const entries = names.map((alias) => {
	const file = map[alias];
	const svg = fs.readFileSync(path.join(root, `${file}.svg`), 'utf8');
	const ds = pathDs(svg);
	const list = ds.map((d) => `\t\t'${d.replace(/'/g, "\\'")}'`).join(',\n');
	return `\t'${alias}': [\n${list}\n\t]`;
});

const sources = names.map((n) => `\t'${n}': '${map[n]}'`).join(',\n');

const out = `/** Semantic icon names → Myna UI path data (@mynaui/icons). Regenerate with \`node scripts/generate-icons.mjs\`. */
export const iconNames = [
${names.map((n) => `\t'${n}'`).join(',\n')}
] as const;

export type IconName = (typeof iconNames)[number];

/** Path \`d\` attributes for each icon (stroke comes from Icon.svelte). */
export const iconPaths: Record<IconName, readonly string[]> = {
${entries.join(',\n')}
};

/** Myna filename for each semantic name (documentation / regeneration). */
export const iconSources: Record<IconName, string> = {
${sources}
};
`;

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, out);
console.log(`Wrote ${names.length} icons → ${path.relative(process.cwd(), outFile)}`);
