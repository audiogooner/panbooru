/** Semantic icon names → Lucide nodes (lucide-static). Regenerate with `node scripts/generate-icons.mjs`. */
export type IconNode = readonly [tag: string, attrs: Record<string, string>];

export const iconNames = [
	'search',
	'book-image',
	'heart',
	'plus',
	'x',
	'sort',
	'up',
	'shuffle',
	'star',
	'rating',
	'image',
	'film',
	'play',
	'animate',
	'settings',
	'sliders',
	'external',
	'download',
	'full',
	'panel',
	'left',
	'right',
	'pin',
	'saved',
	'artist',
	'character',
	'pencil',
	'check',
	'trash'
] as const;

export type IconName = (typeof iconNames)[number];

/** Lucide SVG child nodes for each icon (stroke comes from Icon.svelte). */
export const iconNodes: Record<IconName, readonly IconNode[]> = {
	search: [
		[
			'path',
			{
				d: 'm21 21-4.34-4.34'
			}
		],
		[
			'circle',
			{
				cx: '11',
				cy: '11',
				r: '8'
			}
		]
	],
	'book-image': [
		[
			'path',
			{
				d: 'm20 13.7-2.1-2.1a2 2 0 0 0-2.8 0L9.7 17'
			}
		],
		[
			'path',
			{
				d: 'M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20'
			}
		],
		[
			'circle',
			{
				cx: '10',
				cy: '8',
				r: '2'
			}
		]
	],
	heart: [
		[
			'path',
			{
				d: 'M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5'
			}
		]
	],
	plus: [
		[
			'path',
			{
				d: 'M5 12h14'
			}
		],
		[
			'path',
			{
				d: 'M12 5v14'
			}
		]
	],
	x: [
		[
			'path',
			{
				d: 'M18 6 6 18'
			}
		],
		[
			'path',
			{
				d: 'm6 6 12 12'
			}
		]
	],
	sort: [
		[
			'path',
			{
				d: 'm3 16 4 4 4-4'
			}
		],
		[
			'path',
			{
				d: 'M7 20V4'
			}
		],
		[
			'path',
			{
				d: 'M11 4h4'
			}
		],
		[
			'path',
			{
				d: 'M11 8h7'
			}
		],
		[
			'path',
			{
				d: 'M11 12h10'
			}
		]
	],
	up: [
		[
			'path',
			{
				d: 'm3 8 4-4 4 4'
			}
		],
		[
			'path',
			{
				d: 'M7 4v16'
			}
		],
		[
			'path',
			{
				d: 'M11 12h4'
			}
		],
		[
			'path',
			{
				d: 'M11 16h7'
			}
		],
		[
			'path',
			{
				d: 'M11 20h10'
			}
		]
	],
	shuffle: [
		[
			'path',
			{
				d: 'm18 14 4 4-4 4'
			}
		],
		[
			'path',
			{
				d: 'm18 2 4 4-4 4'
			}
		],
		[
			'path',
			{
				d: 'M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22'
			}
		],
		[
			'path',
			{
				d: 'M2 6h1.972a4 4 0 0 1 3.6 2.2'
			}
		],
		[
			'path',
			{
				d: 'M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45'
			}
		]
	],
	star: [
		[
			'path',
			{
				d: 'M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z'
			}
		]
	],
	rating: [
		[
			'path',
			{
				d: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z'
			}
		],
		[
			'path',
			{
				d: 'm9 12 2 2 4-4'
			}
		]
	],
	image: [
		[
			'rect',
			{
				width: '18',
				height: '18',
				x: '3',
				y: '3',
				rx: '2',
				ry: '2'
			}
		],
		[
			'circle',
			{
				cx: '9',
				cy: '9',
				r: '2'
			}
		],
		[
			'path',
			{
				d: 'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21'
			}
		]
	],
	film: [
		[
			'rect',
			{
				width: '18',
				height: '18',
				x: '3',
				y: '3',
				rx: '2'
			}
		],
		[
			'path',
			{
				d: 'M7 3v18'
			}
		],
		[
			'path',
			{
				d: 'M3 7.5h4'
			}
		],
		[
			'path',
			{
				d: 'M3 12h18'
			}
		],
		[
			'path',
			{
				d: 'M3 16.5h4'
			}
		],
		[
			'path',
			{
				d: 'M17 3v18'
			}
		],
		[
			'path',
			{
				d: 'M17 7.5h4'
			}
		],
		[
			'path',
			{
				d: 'M17 16.5h4'
			}
		]
	],
	play: [
		[
			'path',
			{
				d: 'M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z'
			}
		]
	],
	animate: [
		[
			'path',
			{
				d: 'M13 13.74a2 2 0 0 1-2 0L2.5 8.87a1 1 0 0 1 0-1.74L11 2.26a2 2 0 0 1 2 0l8.5 4.87a1 1 0 0 1 0 1.74z'
			}
		],
		[
			'path',
			{
				d: 'm20 14.285 1.5.845a1 1 0 0 1 0 1.74L13 21.74a2 2 0 0 1-2 0l-8.5-4.87a1 1 0 0 1 0-1.74l1.5-.845'
			}
		]
	],
	settings: [
		[
			'path',
			{
				d: 'M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915'
			}
		],
		[
			'circle',
			{
				cx: '12',
				cy: '12',
				r: '3'
			}
		]
	],
	sliders: [
		[
			'path',
			{
				d: 'M10 5H3'
			}
		],
		[
			'path',
			{
				d: 'M12 19H3'
			}
		],
		[
			'path',
			{
				d: 'M14 3v4'
			}
		],
		[
			'path',
			{
				d: 'M16 17v4'
			}
		],
		[
			'path',
			{
				d: 'M21 12h-9'
			}
		],
		[
			'path',
			{
				d: 'M21 19h-5'
			}
		],
		[
			'path',
			{
				d: 'M21 5h-7'
			}
		],
		[
			'path',
			{
				d: 'M8 10v4'
			}
		],
		[
			'path',
			{
				d: 'M8 12H3'
			}
		]
	],
	external: [
		[
			'path',
			{
				d: 'M15 3h6v6'
			}
		],
		[
			'path',
			{
				d: 'M10 14 21 3'
			}
		],
		[
			'path',
			{
				d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'
			}
		]
	],
	download: [
		[
			'path',
			{
				d: 'M12 15V3'
			}
		],
		[
			'path',
			{
				d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'
			}
		],
		[
			'path',
			{
				d: 'm7 10 5 5 5-5'
			}
		]
	],
	full: [
		[
			'path',
			{
				d: 'M8 3H5a2 2 0 0 0-2 2v3'
			}
		],
		[
			'path',
			{
				d: 'M21 8V5a2 2 0 0 0-2-2h-3'
			}
		],
		[
			'path',
			{
				d: 'M3 16v3a2 2 0 0 0 2 2h3'
			}
		],
		[
			'path',
			{
				d: 'M16 21h3a2 2 0 0 0 2-2v-3'
			}
		]
	],
	panel: [
		[
			'rect',
			{
				width: '18',
				height: '18',
				x: '3',
				y: '3',
				rx: '2'
			}
		],
		[
			'path',
			{
				d: 'M15 3v18'
			}
		]
	],
	left: [
		[
			'path',
			{
				d: 'm15 18-6-6 6-6'
			}
		]
	],
	right: [
		[
			'path',
			{
				d: 'm9 18 6-6-6-6'
			}
		]
	],
	pin: [
		[
			'path',
			{
				d: 'M12 17v5'
			}
		],
		[
			'path',
			{
				d: 'M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z'
			}
		]
	],
	saved: [
		[
			'path',
			{
				d: 'M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z'
			}
		]
	],
	artist: [
		[
			'path',
			{
				d: 'm11 10 3 3'
			}
		],
		[
			'path',
			{
				d: 'M6.5 21A3.5 3.5 0 1 0 3 17.5a2.62 2.62 0 0 1-.708 1.792A1 1 0 0 0 3 21z'
			}
		],
		[
			'path',
			{
				d: 'M9.969 17.031 21.378 5.624a1 1 0 0 0-3.002-3.002L6.967 14.031'
			}
		]
	],
	character: [
		[
			'path',
			{
				d: 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2'
			}
		],
		[
			'circle',
			{
				cx: '12',
				cy: '7',
				r: '4'
			}
		]
	],
	pencil: [
		[
			'path',
			{
				d: 'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z'
			}
		],
		[
			'path',
			{
				d: 'm15 5 4 4'
			}
		]
	],
	check: [
		[
			'path',
			{
				d: 'M20 6 9 17l-5-5'
			}
		]
	],
	trash: [
		[
			'path',
			{
				d: 'M10 11v6'
			}
		],
		[
			'path',
			{
				d: 'M14 11v6'
			}
		],
		[
			'path',
			{
				d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6'
			}
		],
		[
			'path',
			{
				d: 'M3 6h18'
			}
		],
		[
			'path',
			{
				d: 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'
			}
		]
	]
};

/** Lucide filename for each semantic name (documentation / regeneration). */
export const iconSources: Record<IconName, string> = {
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
