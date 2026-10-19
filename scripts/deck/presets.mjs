import { ASSETS } from '../constants.mjs';

/**
 * A preset describes the 4 suits, their default damage type (book suggestion) and the image of each card.
 * Each card image path may be overridden per actor through the deck editor.
 */
export const PRESETS = {
	poker: {
		label: 'FUAOC.Preset.poker',
		back: `${ASSETS}/poker/back.svg`,
		suits: [
			{ key: 'diamonds', label: 'FUAOC.Suit.diamonds', symbol: '♦', damage: 'air' },
			{ key: 'clubs', label: 'FUAOC.Suit.clubs', symbol: '♣', damage: 'earth' },
			{ key: 'hearts', label: 'FUAOC.Suit.hearts', symbol: '♥', damage: 'fire' },
			{ key: 'spades', label: 'FUAOC.Suit.spades', symbol: '♠', damage: 'ice' },
		],
		face: (suitKey, value) => `${ASSETS}/poker/${suitKey}-${value}.svg`,
		valueLabel: (value) => (value === 1 ? 'A' : String(value)),
		jokers: [
			{ name: 'Joker', img: `${ASSETS}/poker/joker-1.svg` },
			{ name: 'Joker', img: `${ASSETS}/poker/joker-2.svg` },
		],
	},
	/**
	 * Final Fantasy art supplied by the table (not bundled with the module).
	 * Files live in the Foundry user data folder: ace-of-cards-decks/final-fantasy/{value}{C|D|H|S}.webp, 1J.webp, 2J.webp
	 * and optionally back.webp.
	 */
	finalFantasy: {
		label: 'FUAOC.Preset.finalFantasy',
		external: true,
		base: 'ace-of-cards-decks/final-fantasy',
		back: `${ASSETS}/poker/back.svg`,
		suits: [
			{ key: 'diamonds', code: 'D', label: 'FUAOC.Suit.diamonds', symbol: '♦', damage: 'air' },
			{ key: 'clubs', code: 'C', label: 'FUAOC.Suit.clubs', symbol: '♣', damage: 'earth' },
			{ key: 'hearts', code: 'H', label: 'FUAOC.Suit.hearts', symbol: '♥', damage: 'fire' },
			{ key: 'spades', code: 'S', label: 'FUAOC.Suit.spades', symbol: '♠', damage: 'ice' },
		],
		face(suitKey, value) {
			const code = this.suits.find((s) => s.key === suitKey)?.code;
			return `${this.base}/${value}${code}.webp`;
		},
		valueLabel: (value) => (value === 1 ? 'A' : String(value)),
		jokers: [
			{ name: 'Joker', img: 'ace-of-cards-decks/final-fantasy/1J.webp' },
			{ name: 'Joker', img: 'ace-of-cards-decks/final-fantasy/2J.webp' },
		],
	},
	tarot: {
		label: 'FUAOC.Preset.tarot',
		back: `${ASSETS}/tarot/back.webp`,
		suits: [
			{ key: 'swords', label: 'FUAOC.Suit.swords', symbol: '⚔', damage: 'air' },
			{ key: 'pentacles', label: 'FUAOC.Suit.pentacles', symbol: '⛤', damage: 'earth' },
			{ key: 'wands', label: 'FUAOC.Suit.wands', symbol: '⚚', damage: 'fire' },
			{ key: 'cups', label: 'FUAOC.Suit.cups', symbol: '♆', damage: 'ice' },
		],
		face: (suitKey, value) => `${ASSETS}/tarot/${suitKey}-${value}.webp`,
		valueLabel: (value) => (value === 1 ? 'Ace' : String(value)),
		jokers: [
			{ name: 'The Fool', img: `${ASSETS}/tarot/fool.webp` },
			{ name: 'The World', img: `${ASSETS}/tarot/world.webp` },
		],
		/** Tarot art is added in phase 4; until then the preset is hidden from the picker. */
		available: false,
	},
};

/** Presets that can be picked in the GM panel. */
export function availablePresets() {
	return Object.entries(PRESETS)
		.filter(([, p]) => p.available !== false)
		.map(([key, p]) => ({ key, label: game.i18n.localize(p.label) }));
}

/** Default per-actor configuration. */
export function defaultConfig(presetKey = 'poker') {
	const preset = PRESETS[presetKey] ?? PRESETS.poker;
	return {
		preset: presetKey,
		suitMap: Object.fromEntries(preset.suits.map((s) => [s.key, s.damage])),
		images: {}, // { 'hearts-7': 'path', 'joker-1': 'path', back: 'path' }
	};
}

/** Build the 30 Card creation datas for a preset + actor configuration. */
export function buildCardData(config, moduleId) {
	const preset = PRESETS[config.preset] ?? PRESETS.poker;
	const back = config.images?.back || preset.back;
	const cards = [];
	let sort = 0;
	for (const suit of preset.suits) {
		for (let value = 1; value <= 7; value++) {
			const key = `${suit.key}-${value}`;
			const damage = config.suitMap?.[suit.key] ?? suit.damage;
			cards.push({
				name: `${preset.valueLabel(value)} ${suit.symbol}`,
				type: 'base',
				suit: suit.key,
				value,
				face: null,
				back: { name: 'Ace of Cards', img: back },
				faces: [{ name: `${preset.valueLabel(value)} ${suit.symbol}`, img: config.images?.[key] || preset.face.call(preset, suit.key, value) }],
				sort: sort++,
				flags: { [moduleId]: { joker: false, damage } },
			});
		}
	}
	preset.jokers.forEach((j, i) => {
		const key = `joker-${i + 1}`;
		cards.push({
			name: j.name,
			type: 'base',
			suit: 'joker',
			value: 0,
			face: null,
			back: { name: 'Ace of Cards', img: back },
			faces: [{ name: j.name, img: config.images?.[key] || j.img }],
			sort: sort++,
			flags: { [moduleId]: { joker: true, damage: null } },
		});
	});
	return cards;
}
