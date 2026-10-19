import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findSets, computeEffect, highOrLow, maxCards } from '../scripts/rules/sets.mjs';

let n = 0;
const c = (value, suit = 'fire') => ({ id: `c${n++}`, value, suit, joker: false });
const J = () => ({ id: `j${n++}`, value: null, suit: null, joker: true });
const effects = (cards, o) => findSets(cards, o).map((x) => `${x.effect}:${x.variant}`);

test('magic pair', () => {
	assert.deepEqual(effects([c(3), c(3, 'ice')]), ['magicPair:any']);
	assert.deepEqual(effects([c(3), c(4)]), []);
});
test('triple support total x3', () => {
	const [o] = findSets([c(5), c(5, 'ice'), c(5, 'air')]);
	assert.equal(o.effect, 'tripleSupport');
	assert.equal(computeEffect(o).hp, 45);
});
test('jackpot requires no joker', () => {
	assert.ok(effects([c(2), c(2, 'ice'), c(2, 'air'), c(2, 'earth')]).includes('jackpot:any'));
	assert.ok(!effects([c(2), c(2, 'ice'), c(2, 'air'), J()]).includes('jackpot:any'));
});
test('magic flush vs blinding flush', () => {
	const e = effects([c(3), c(4), c(5), c(6)]);
	assert.ok(e.includes('magicFlush:fire'));
	assert.ok(e.includes('blindingFlush:light'));
	const mixed = effects([c(3), c(4, 'ice'), c(5), c(6)]);
	assert.ok(!mixed.some((x) => x.startsWith('magicFlush')));
	assert.ok(mixed.includes('blindingFlush:light'));
});
test('flush damage with level bonus', () => {
	const o = findSets([c(4), c(5), c(6), c(7)]).find((x) => x.effect === 'magicFlush');
	assert.equal(computeEffect(o, { level: 5 }).amount, 25 + 22);
	assert.equal(computeEffect(o, { level: 20 }).amount, 25 + 22 + 10);
	assert.equal(computeEffect(o, { level: 40 }).type, 'fire');
});
test('joker fills a flush and picks best total', () => {
	const sets = findSets([c(5), c(6), c(7), J()]);
	const mf = sets.find((x) => x.effect === 'magicFlush');
	assert.equal(mf.jokers[0].value, 4);
	assert.equal(mf.jokers[0].suit, 'fire');
	const bf = sets.filter((x) => x.effect === 'blindingFlush').map((x) => x.variant).sort();
	assert.deepEqual(bf, ['dark']); // highest is 7 either way (4-7)... joker can't exceed 7
});
test('blinding flush parity choice with joker at the top', () => {
	const sets = findSets([c(2), c(3), c(4), J()]);
	const variants = sets.filter((x) => x.effect === 'blindingFlush').map((x) => x.variant).sort();
	assert.deepEqual(variants, ['dark', 'light']); // 1-4 (even top) or 2-5 (odd top)
});
test('full status 3+2 and parity', () => {
	const sets = findSets([c(6), c(6, 'ice'), c(6, 'air'), c(3), c(3, 'ice')]);
	const fs = sets.find((x) => x.effect === 'fullStatus');
	assert.equal(fs.variant, 'even');
	assert.equal(computeEffect(fs).target, 'allies');
});
test('double trouble 2 pairs', () => {
	const o = findSets([c(2), c(2, 'ice'), c(5), c(5, 'air')]).find((x) => x.effect === 'doubleTrouble');
	const e = computeEffect(o);
	assert.equal(e.amount, 15);
	assert.deepEqual(e.typeChoices.sort(), ['air', 'fire', 'ice']);
});
test('exact size: 5 same-value-like cards are not jackpot', () => {
	const e = effects([c(2), c(2, 'ice'), c(2, 'air'), c(2, 'earth'), J()]);
	assert.ok(!e.includes('jackpot:any'));
	assert.ok(e.includes('fullStatus:even'));
	assert.ok(!e.some((x) => x.startsWith('forbiddenMonarch')));
	assert.ok(effects([c(2), c(2, 'ice'), c(2, 'air'), c(2, 'earth'), J()], { forbiddenRite: true }).includes('forbiddenMonarch:light'));
});
test('high or low', () => {
	assert.deepEqual(highOrLow([c(7), c(7)], 3), { extraDamage: 3, damageReduction: 0, heal: 0 });
	assert.deepEqual(highOrLow([J(), c(4)], 2), { extraDamage: 2, damageReduction: 2, heal: 0 });
	assert.deepEqual(highOrLow([c(4), c(4)], 2), { extraDamage: 0, damageReduction: 0, heal: 4 });
	assert.equal(highOrLow([c(4)], 0), null);
});
test('max cards by SL', () => {
	assert.equal(maxCards(1), 3);
	assert.equal(maxCards(2), 4);
	assert.equal(maxCards(3), 5);
});
test('every 2..5 subset of a full deck resolves without throwing', () => {
	const deck = [];
	for (const s of ['air', 'earth', 'fire', 'ice']) for (let v = 1; v <= 7; v++) deck.push(c(v, s));
	deck.push(J(), J());
	let checked = 0;
	for (let i = 0; i < 400; i++) {
		const k = 2 + (i % 4);
		const pick = [...deck].sort(() => Math.random() - 0.5).slice(0, k);
		for (const o of findSets(pick)) computeEffect(o);
		checked++;
	}
	assert.equal(checked, 400);
});

import { validateSwap, swapLimit, trapSpellBudget } from '../scripts/rules/sets.mjs';

test('black & white adds light/dark to double trouble', () => {
	const [opt] = findSets([c(2, 'fire'), c(2, 'ice'), c(5, 'fire'), c(5, 'air')]).filter((o) => o.effect === 'doubleTrouble');
	assert.deepEqual(computeEffect(opt).typeChoices.sort(), ['air', 'fire', 'ice']);
	assert.deepEqual(computeEffect(opt, { blackWhite: true }).typeChoices.slice(-2), ['light', 'dark']);
});

test('mulligan: up to SL + 1 cards, any suit', () => {
	assert.equal(swapLimit(2), 3);
	assert.equal(validateSwap('mulligan', [c(1), c(2, 'ice'), J()], 2), null);
	assert.equal(validateSwap('mulligan', [c(1), c(2), c(3), c(4)], 2), 'swapCount');
	assert.equal(validateSwap('mulligan', [], 2), 'swapCount');
	assert.equal(validateSwap('mulligan', [c(1)], 0), 'noSkill');
});

test('trap card: suit must match the enemy action, jokers always allowed', () => {
	assert.equal(validateSwap('trapCard', [c(3, 'ice'), J()], 1, 'attack'), null);
	assert.equal(validateSwap('trapCard', [c(3, 'fire')], 1, 'attack'), 'trapSuit');
	assert.equal(validateSwap('trapCard', [c(3, 'air')], 1, 'spell'), null);
	assert.equal(validateSwap('trapCard', [c(3, 'earth')], 1, 'skill'), null);
	assert.equal(validateSwap('trapCard', [c(3, 'fire')], 1, 'objective'), null);
	assert.equal(validateSwap('trapCard', [c(3, 'fire')], 1), 'trapAction');
	assert.equal(trapSpellBudget(2), 10);
});

test('double or nothing: even dice double, others become 1', async () => {
	const { doubleOrNothingValue } = await import('../scripts/rules/sets.mjs');
	assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(doubleOrNothingValue), [1, 4, 1, 8, 1, 12, 1, 16, 1, 20, 1, 24]);
});
