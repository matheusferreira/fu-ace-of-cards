/**
 * Set recognition for the Ace of Cards class (Fabula Ultima Bonus Collection vol.1 v1.1, p. 8-11).
 * Pure module: no Foundry globals, so it can be unit-tested with `node --test`.
 *
 * A card is `{ id, suit, value, joker }`:
 *  - suit: 'air' | 'earth' | 'fire' | 'ice' (damage type the suit is mapped to); null for jokers
 *  - value: 1..7; null for jokers
 *  - joker: boolean
 * When a set includes jokers, the player chooses their suit and value. The engine enumerates every
 * assignment and keeps, for each effect variant, the assignment with the best outcome.
 */

export const SUITS = ['air', 'earth', 'fire', 'ice'];
export const VALUES = [1, 2, 3, 4, 5, 6, 7];

export const EFFECTS = {
	jackpot: { size: 4, order: 1 },
	forbiddenMonarch: { size: 5, order: 0, heroic: 'forbidden-rite' },
	magicFlush: { size: 4, order: 2 },
	blindingFlush: { size: 4, order: 3 },
	fullStatus: { size: 5, order: 4 },
	tripleSupport: { size: 3, order: 5 },
	doubleTrouble: { size: 4, order: 6 },
	magicPair: { size: 2, order: 7 },
};

function counts(values) {
	const m = new Map();
	for (const v of values) m.set(v, (m.get(v) || 0) + 1);
	return [...m.values()].sort((a, b) => b - a);
}

function isConsecutive(values) {
	const s = [...values].sort((a, b) => a - b);
	for (let i = 1; i < s.length; i++) if (s[i] !== s[i - 1] + 1) return false;
	return true;
}

/** Which effects does a fully resolved set (no unassigned jokers) match? `raw` keeps the joker flags. */
export function matchResolved(resolved, raw, { forbiddenRite = false } = {}) {
	const n = resolved.length;
	const values = resolved.map((c) => c.value);
	const suits = resolved.map((c) => c.suit);
	const c = counts(values);
	const out = [];
	const jokers = raw.filter((x) => x.joker).length;
	if (n === 4 && c[0] === 4 && jokers === 0) out.push('jackpot');
	if (forbiddenRite && n === 5 && jokers === 1) {
		const nonJ = raw.filter((x) => !x.joker).map((x) => x.value);
		if (nonJ.length === 4 && counts(nonJ)[0] === 4) out.push('forbiddenMonarch');
	}
	if (n === 4 && c.length === 4 && isConsecutive(values)) {
		if (new Set(suits).size === 1) out.push('magicFlush');
		out.push('blindingFlush');
	}
	if (n === 5 && ((c[0] === 3 && c[1] === 2) || c[0] === 5)) out.push('fullStatus');
	if (n === 3 && c[0] === 3) out.push('tripleSupport');
	if (n === 4 && ((c[0] === 2 && c[1] === 2) || c[0] === 4)) out.push('doubleTrouble');
	if (n === 2 && c[0] === 2) out.push('magicPair');
	return out;
}

function* jokerAssignments(count) {
	if (count === 0) {
		yield [];
		return;
	}
	for (const suit of SUITS) for (const value of VALUES) for (const rest of jokerAssignments(count - 1)) yield [{ suit, value }, ...rest];
}

/** Variant key and score for an effect given its resolved cards (used to keep one option per meaningful choice). */
function describe(effect, resolved) {
	const values = resolved.map((c) => c.value);
	const total = values.reduce((a, b) => a + b, 0);
	const highest = Math.max(...values);
	switch (effect) {
		case 'magicFlush':
			return { variant: resolved[0].suit, score: total };
		case 'blindingFlush':
			return { variant: highest % 2 === 0 ? 'light' : 'dark', score: total };
		case 'fullStatus':
			return { variant: highest % 2 === 0 ? 'even' : 'odd', score: highest };
		case 'doubleTrouble':
			return { variant: 'any', score: highest };
		case 'tripleSupport':
			return { variant: 'any', score: total };
		case 'magicPair':
			return { variant: 'any', score: values[0] };
		case 'forbiddenMonarch': {
			const common = resolved.find((c) => !c.joker)?.value ?? values[0];
			return { variant: common % 2 === 0 ? 'light' : 'dark', score: common };
		}
		default:
			return { variant: 'any', score: total };
	}
}

/**
 * Enumerate the set effects a selection of cards can produce.
 * @param {Array<{id:string,suit:string|null,value:number|null,joker:boolean}>} cards
 * @param {{forbiddenRite?: boolean}} [options]
 * @returns {Array<{effect:string, variant:string, score:number, resolved:Array, jokers:Array}>}
 */
export function findSets(cards, options = {}) {
	if (!cards.length || cards.length > 5) return [];
	const jokerIdx = cards.map((c, i) => (c.joker ? i : -1)).filter((i) => i >= 0);
	const best = new Map();
	for (const assign of jokerAssignments(jokerIdx.length)) {
		const resolved = cards.map((c) => ({ ...c }));
		jokerIdx.forEach((idx, k) => Object.assign(resolved[idx], assign[k]));
		for (const effect of matchResolved(resolved, cards, options)) {
			const { variant, score } = describe(effect, resolved);
			const key = `${effect}:${variant}`;
			const prev = best.get(key);
			if (!prev || score > prev.score) {
				best.set(key, {
					effect,
					variant,
					score,
					resolved,
					jokers: jokerIdx.map((idx) => ({ id: cards[idx].id, suit: resolved[idx].suit, value: resolved[idx].value })),
				});
			}
		}
	}
	return [...best.values()].sort((a, b) => EFFECTS[a.effect].order - EFFECTS[b.effect].order || b.score - a.score);
}

/** Bonus for Blinding Flush, Double Trouble and Magic Flush at levels 20 and 40. */
export function levelBonus(level) {
	return level >= 40 ? 20 : level >= 20 ? 10 : 0;
}

/**
 * Compute the numbers of an effect, ready for a chat card / application.
 * @param {object} option   an entry returned by findSets
 * @param {{level:number}} ctx
 */
export function computeEffect(option, { level = 5, blackWhite = false } = {}) {
	const r = option.resolved;
	const values = r.map((c) => c.value);
	const total = values.reduce((a, b) => a + b, 0);
	const highest = Math.max(...values);
	const bonus = levelBonus(level);
	switch (option.effect) {
		case 'jackpot':
			return { kind: 'recovery', target: 'allies', hp: 777, mp: 777, revive: true };
		case 'forbiddenMonarch':
			return { kind: 'damage', target: 'allEnemies', amount: 777, type: option.variant, ignoreResistances: 'ifJokerInDiscard' };
		case 'magicFlush':
			return { kind: 'damage', target: 'allEnemies', amount: 25 + total + bonus, type: r[0].suit };
		case 'blindingFlush':
			return { kind: 'damage', target: 'allEnemies', amount: 15 + total + bonus, type: option.variant };
		case 'fullStatus':
			return { kind: 'status', target: highest % 2 === 0 ? 'allies' : 'allEnemies', mode: highest % 2 === 0 ? 'remove' : 'inflict', choose: 2, from: ['dazed', 'shaken', 'slow', 'weak'] };
		case 'tripleSupport':
			return { kind: 'recovery', target: 'allies', hp: total * 3, mp: 0 };
		case 'doubleTrouble':
			return { kind: 'damage', target: 'upToTwoEnemies', amount: 10 + highest + bonus, typeChoices: [...new Set(r.map((c) => c.suit)), ...(blackWhite ? ['light', 'dark'] : [])] };
		case 'magicPair':
			return { kind: 'freeAttack', typeChoices: [...new Set(r.map((c) => c.suit))], pairValue: values[0] };
		default:
			return { kind: 'none' };
	}
}

/** High or Low (SL 1-5): evaluated on the cards as played (jokers count as jokers). */
export function highOrLow(cards, sl) {
	if (!sl) return null;
	const hasJoker = cards.some((c) => c.joker);
	const has7 = cards.some((c) => !c.joker && c.value === 7);
	const has1 = cards.some((c) => !c.joker && c.value === 1);
	const result = { extraDamage: 0, damageReduction: 0, heal: 0 };
	if (hasJoker || has7) result.extraDamage = sl;
	if (hasJoker || has1) result.damageReduction = sl;
	if (!hasJoker && !has7 && !has1) result.heal = sl * 2;
	return result;
}

/** Magic Cards: max MP spend is 10 + SL*5 (min 10); each card costs 5 MP; max 5 cards. */
export function maxCards(sl) {
	return Math.min(5, Math.floor(Math.max(10, 10 + sl * 5) / 5));
}

/** Spending at least 10 MP means at least 2 cards. */
export const MIN_CARDS = 2;

export function mpCost(cardCount) {
	return cardCount * 5;
}

/** Trap Card: suits allowed per enemy action. */
export const TRAP_SUIT = { attack: 'ice', objective: 'fire', skill: 'earth', spell: 'air' };

/** Mulligan and Trap Card: discard up to SL + 1 cards and draw that many. */
export function swapLimit(sl) {
	return sl > 0 ? sl + 1 : 0;
}

/**
 * Validate a Mulligan / Trap Card discard.
 * @param {'mulligan'|'trapCard'} kind
 * @param {{joker:boolean, suit:string|null}[]} cards  rule cards
 * @param {number} sl                                  skill level of that skill
 * @param {string} [action]                            Trap Card: attack | objective | skill | spell
 * @returns {string|null} error key under FUAOC.Error, or null when valid
 */
export function validateSwap(kind, cards, sl, action) {
	if (!sl) return 'noSkill';
	if (!cards.length || cards.length > swapLimit(sl)) return 'swapCount';
	if (kind === 'trapCard') {
		const suit = TRAP_SUIT[action];
		if (!suit) return 'trapAction';
		if (!cards.every((c) => c.joker || c.suit === suit)) return 'trapSuit';
	}
	return null;
}

/** Highest total MP cost of the free spell granted by Trap Card. */
export function trapSpellBudget(sl) {
	return sl * 5;
}

/** Double or Nothing: an even die counts double, any other die counts as 1. */
export function doubleOrNothingValue(value) {
	return value % 2 === 0 ? value * 2 : 1;
}
