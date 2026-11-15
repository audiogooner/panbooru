#!/usr/bin/env node
/**
 * Rebuild src/lib/icons/paths.ts from lucide-static icon nodes.
 * Keeps Panbooru semantic names; maps them to Lucide filenames below.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outFile = path.join(__dirname, '../src/lib/icons/paths.ts');

/** @type {Record<string, [string, Record<string, string>][]>} */
const lucideNodes = require('lucide-static/icon-nodes.json');

/** @type {Record<string, string>} */
const map = {
	search: 'search',
	'book-image': 'book-image',
	heart: 'heart',
	plus: 'plus',
	x: 'x',
	sort: 'arrow-down-narrow-wide',
	up: 'arrow-up-narrow-wide',
	shuffle: 'shuffle',
	star: 'star',
	rating: 'shield-check',
	image: 'image',
	film: 'film',
	play: 'play',
	animate: 'layers-2',
	settings: 'settings',
	sliders: 'sliders-horizontal',
	external: 'external-link',
	download: 'download',
	full: 'maximize',
	panel: 'panel-right',
	left: 'chevron-left',
	right: 'chevron-right',
	pin: 'pin',
	saved: 'bookmark',
	artist: 'brush',
	character: 'user',
	pencil: 'pencil',
	check: 'check',
	trash: 'trash'
};

const names = Object.keys(map);

/** @param {unknown} value */
function serialize(value) {
	return JSON.stringify(value, null, '\t').replace(/\n/g, '\n\t');
}

const missing = names.filter((alias) => !lucideNodes[map[alias]]);
if (missing.length) {
	throw new Error(`Missing Lucide icons: ${missing.map((n) => map[n]).join(', ')}`);
}

const entries = names.map((alias) => {
	const nodes = lucideNodes[map[alias]];
	return `\t${JSON.stringify(alias)}: ${serialize(nodes)}`;
});

const sources = names.map((n) => `\t${JSON.stringify(n)}: ${JSON.stringify(map[n])}`).join(',\n');

const out = `/** Semantic icon names → Lucide nodes (lucide-static). Regenerate with \`node scripts/generate-icons.mjs\`. */
export type IconNode = readonly [tag: string, attrs: Record<string, string>];

export const iconNames = [
${names.map((n) => `\t${JSON.stringify(n)}`).join(',\n')}
] as const;

export type IconName = (typeof iconNames)[number];

/** Lucide SVG child nodes for each icon (stroke comes from Icon.svelte). */
export const iconNodes: Record<IconName, readonly IconNode[]> = {
${entries.join(',\n')}
};

/** Lucide filename for each semantic name (documentation / regeneration). */
export const iconSources: Record<IconName, string> = {
${sources}
};
`;

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, out);
console.log(`Wrote ${names.length} icons → ${path.relative(process.cwd(), outFile)}`);
