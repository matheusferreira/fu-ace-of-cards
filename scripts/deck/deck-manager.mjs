import { MODULE_ID, FLAGS, FUID, HAND_SIZE } from '../constants.mjs';
import { buildCardData, defaultConfig, PRESETS } from './presets.mjs';

const OWN = () => CONST.DOCUMENT_OWNERSHIP_LEVELS;
const QUIET = { chatNotification: false };

/* -------------------------------------------- */
/*  Actor helpers                               */
/* -------------------------------------------- */

/** Find an item on the actor by its projectfu identifier. */
export function findFeature(actor, fuid) {
	return actor?.items?.find((i) => i.system?.fuid === fuid) ?? null;
}

/** Skill Level of a class skill (0 if the actor does not have it). */
export function skillLevel(actor, fuid) {
	const item = findFeature(actor, fuid);
	if (!item) return 0;
	return Number(item.system?.level?.value ?? 1) || 0;
}

export function hasHeroic(actor, fuid) {
	return !!findFeature(actor, fuid);
}

export function isAce(actor) {
	return skillLevel(actor, FUID.magicCards) > 0;
}

export function actorLevel(actor) {
	return Number(actor?.system?.level?.value ?? 5) || 5;
}

export function getConfig(actor) {
	return foundry.utils.mergeObject(defaultConfig(), actor.getFlag(MODULE_ID, FLAGS.actorConfig) ?? {}, { inplace: false });
}

/* -------------------------------------------- */
/*  Stacks                                      */
/* -------------------------------------------- */

/** @returns {{deck:Cards, hand:Cards, discard:Cards, vanguard:Cards}|null} */
export function getStacks(actor) {
	const ids = actor?.getFlag(MODULE_ID, FLAGS.actorStacks);
	if (!ids) return null;
	const stacks = {
		deck: game.cards.get(ids.deck),
		hand: game.cards.get(ids.hand),
		discard: game.cards.get(ids.discard),
		vanguard: game.cards.get(ids.vanguard),
	};
	if (!stacks.deck || !stacks.hand || !stacks.discard) return null;
	return stacks;
}

/** Actors that have an Ace of Cards deck in this world (or at least the Magic Cards skill). */
export function aceActors() {
	return game.actors.filter((a) => a.type === 'character' && (isAce(a) || a.getFlag(MODULE_ID, FLAGS.actorStacks)));
}

function playerOwners(actor) {
	return game.users.filter((u) => !u.isGM && actor.testUserPermission(u, 'OWNER'));
}

function ownership(actor, defaultLevel) {
	const o = { default: defaultLevel };
	for (const u of playerOwners(actor)) o[u.id] = OWN().OWNER;
	return o;
}

async function getFolder() {
	const name = 'Ace of Cards';
	let folder = game.folders.find((f) => f.type === 'Cards' && f.getFlag(MODULE_ID, 'root'));
	if (!folder) folder = await Folder.create({ name, type: 'Cards', color: '#6a3fa0', flags: { [MODULE_ID]: { root: true } } });
	return folder;
}

/**
 * Create the four card stacks of an actor (GM only). Idempotent: existing stacks are reused.
 * @param {Actor} actor
 * @param {{rebuild?: boolean}} [options] rebuild = delete the deck's cards and recreate them from the configuration
 */
export async function ensureStacks(actor, { rebuild = false } = {}) {
	if (!game.user.isGM) throw new Error('ensureStacks must run on a GM client');
	const existing = getStacks(actor);
	const config = getConfig(actor);
	const cardData = buildCardData(config, MODULE_ID);
	if (existing && !rebuild) return existing;
	if (existing && rebuild) {
		await existing.deck.recall(QUIET);
		await existing.deck.deleteEmbeddedDocuments('Card', existing.deck.cards.map((c) => c.id));
		await existing.deck.createEmbeddedDocuments('Card', cardData);
		await existing.deck.update({ img: config.images?.back || cardData[0].back.img });
		return existing;
	}
	const folder = await getFolder();
	const base = (role, type, defaultLevel, extra = {}) => ({
		name: `${actor.name} — ${game.i18n.localize(`FUAOC.Stack.${role}`)}`,
		type,
		folder: folder.id,
		ownership: ownership(actor, defaultLevel),
		flags: { [MODULE_ID]: { [FLAGS.stackRole]: role, [FLAGS.stackActor]: actor.uuid } },
		...extra,
	});
	const created = await Cards.createDocuments([
		base('deck', 'deck', OWN().NONE, { cards: cardData, img: cardData[0].back.img }),
		base('hand', 'hand', OWN().NONE),
		base('discard', 'pile', OWN().OBSERVER),
		base('vanguard', 'pile', OWN().NONE),
	]);
	const [deck, hand, discard, vanguard] = created;
	await actor.setFlag(MODULE_ID, FLAGS.actorStacks, { deck: deck.id, hand: hand.id, discard: discard.id, vanguard: vanguard.id });
	return { deck, hand, discard, vanguard };
}

/** Re-apply ownership (after the actor changes owner). GM only. */
export async function syncOwnership(actor) {
	const s = getStacks(actor);
	if (!s) return;
	await s.deck.update({ ownership: ownership(actor, OWN().NONE) }, { diff: false, recursive: false });
	await s.hand.update({ ownership: ownership(actor, OWN().NONE) }, { diff: false, recursive: false });
	await s.discard.update({ ownership: ownership(actor, OWN().OBSERVER) }, { diff: false, recursive: false });
	if (s.vanguard) await s.vanguard.update({ ownership: ownership(actor, OWN().NONE) }, { diff: false, recursive: false });
}

/* -------------------------------------------- */
/*  Card operations                             */
/* -------------------------------------------- */

/** Convert a Card document to the shape used by the rules engine. */
export function toRuleCard(card) {
	const f = card.flags?.[MODULE_ID] ?? {};
	return { id: card.id, suit: f.joker ? null : f.damage, value: f.joker ? null : card.value, joker: !!f.joker, suitKey: card.suit };
}

/** Hand cards in display order. */
export function handCards(actor) {
	const s = getStacks(actor);
	return s ? s.hand.cards.contents.sort((a, b) => a.sort - b.sort) : [];
}

/** Discard pile, oldest first (last element = top). */
export function discardCards(actor) {
	const s = getStacks(actor);
	return s ? s.discard.cards.contents.sort((a, b) => a.sort - b.sort) : [];
}

/** Shuffle the discard pile back into the deck (book: when the deck runs out). */
export async function recycleDiscard(actor) {
	const s = getStacks(actor);
	if (!s || !s.discard.cards.size) return false;
	await s.discard.pass(s.deck, s.discard.cards.map((c) => c.id), QUIET);
	await s.deck.shuffle(QUIET);
	return true;
}

/**
 * Draw cards into the hand. When the deck runs out, shuffle the discard pile into it and keep drawing.
 * @returns {Promise<number>} cards actually drawn
 */
export async function drawCards(actor, number) {
	const s = getStacks(actor);
	if (!s || number <= 0) return 0;
	let remaining = number;
	let drawn = 0;
	let recycled = false;
	while (remaining > 0) {
		const available = s.deck.availableCards.length;
		const take = Math.min(available, remaining);
		if (take > 0) {
			await s.hand.draw(s.deck, take, { how: CONST.CARD_DRAW_MODES.TOP, updateData: { face: 0 }, ...QUIET });
			remaining -= take;
			drawn += take;
		}
		if (remaining > 0) {
			if (recycled || !(await recycleDiscard(actor))) break;
			recycled = true;
		}
	}
	return drawn;
}

/** Move cards from the hand to the top of the discard pile, in the given order. */
export async function discardFromHand(actor, cardIds) {
	const s = getStacks(actor);
	if (!s || !cardIds.length) return [];
	return s.hand.pass(s.discard, cardIds, { action: 'discard', updateData: { face: 0 }, ...QUIET });
}

/** Undo helper: move specific cards from the discard pile back to the hand. */
export async function returnToHand(actor, cardIds) {
	const s = getStacks(actor);
	if (!s || !cardIds.length) return [];
	return s.discard.pass(s.hand, cardIds, { updateData: { face: 0 }, ...QUIET });
}

/** Undo helper: send specific hand cards back to the deck (undrawn), then reshuffle. */
export async function returnToDeck(actor, cardIds) {
	const s = getStacks(actor);
	if (!s || !cardIds.length) return;
	await s.hand.pass(s.deck, cardIds, QUIET);
}

/** Forbidden Rite: shuffle chosen cards from the discard pile into the deck. */
export async function shuffleIntoDeck(actor, cardIds) {
	const s = getStacks(actor);
	const ids = cardIds.filter((id) => s?.discard.cards.has(id));
	if (!ids.length) return [];
	await s.discard.pass(s.deck, ids, QUIET);
	await s.deck.shuffle(QUIET);
	return ids;
}

/** Undo helper: bring cards back to the hand from the discard pile or, if they were shuffled in, from the deck. */
export async function reclaimToHand(actor, cardIds) {
	const s = getStacks(actor);
	if (!s || !cardIds.length) return;
	const fromDiscard = cardIds.filter((id) => s.discard.cards.has(id));
	const fromVanguard = cardIds.filter((id) => s.vanguard?.cards.has(id));
	const fromDeck = cardIds.filter((id) => !s.hand.cards.has(id) && !fromDiscard.includes(id) && !fromVanguard.includes(id) && s.deck.cards.get(id) && !s.deck.cards.get(id).drawn);
	if (fromDiscard.length) await s.discard.pass(s.hand, fromDiscard, { updateData: { face: 0 }, ...QUIET });
	if (fromVanguard.length) await s.vanguard.pass(s.hand, fromVanguard, { updateData: { face: 0 }, ...QUIET });
	if (fromDeck.length) await s.deck.pass(s.hand, fromDeck, { updateData: { face: 0 }, ...QUIET });
}

/** Card Vanguard: cards currently in play as vanguard cards. */
export function vanguardCards(actor) {
	const s = getStacks(actor);
	return s?.vanguard ? s.vanguard.cards.contents.sort((a, b) => a.sort - b.sort) : [];
}

/** Card Vanguard: move a just-discarded card from the discard pile to the vanguard, face down. */
export async function placeVanguard(actor, cardId) {
	const s = getStacks(actor);
	if (!s?.vanguard || !s.discard.cards.has(cardId)) return false;
	await s.discard.pass(s.vanguard, [cardId], { updateData: { face: null }, ...QUIET });
	return true;
}

/** Card Vanguard: reveal a vanguard card and put it on top of the discard pile. */
export async function revealVanguard(actor, cardId) {
	const s = getStacks(actor);
	if (!s?.vanguard?.cards.has(cardId)) return false;
	const top = Math.max(0, ...s.discard.cards.map((c) => c.sort));
	await s.vanguard.pass(s.discard, [cardId], { updateData: { face: 0, sort: top + 1 }, ...QUIET });
	return true;
}

/** Where a card of the actor's deck currently is: 'hand' | 'discard' | 'vanguard' | 'deck'. */
export function cardLocation(actor, cardId) {
	const s = getStacks(actor);
	if (!s) return null;
	if (s.hand.cards.has(cardId)) return 'hand';
	if (s.discard.cards.has(cardId)) return 'discard';
	if (s.vanguard?.cards.has(cardId)) return 'vanguard';
	return 'deck';
}

/** Every card of the actor's deck (all 30) in deck order, with its current location and face image. */
export function allCards(actor) {
	const s = getStacks(actor);
	if (!s) return [];
	const suitOrder = (PRESETS[getConfig(actor).preset] ?? PRESETS.poker).suits.map((x) => x.key);
	const rank = (c) => (c.getFlag(MODULE_ID, 'joker') ? 99 : Math.max(0, suitOrder.indexOf(c.suit)));
	return s.deck.cards.contents
		.sort((a, b) => rank(a) - rank(b) || (a.value ?? 0) - (b.value ?? 0) || a.id.localeCompare(b.id))
		.map((c) => ({
			id: c.id,
			name: c.faces?.[0]?.name ?? c.name,
			img: c.faces?.[0]?.img ?? c.img,
			joker: !!c.getFlag(MODULE_ID, 'joker'),
			suit: c.getFlag(MODULE_ID, 'joker') ? 'joker' : c.suit,
			damage: c.getFlag(MODULE_ID, 'damage'),
			value: c.value,
			location: cardLocation(actor, c.id),
		}));
}

/**
 * GM testing tool: make the hand exactly the given cards. Cards leaving the hand go back into the deck;
 * chosen cards are taken from wherever they are (deck, discard pile or vanguard). The deck is reshuffled.
 */
export async function setHand(actor, cardIds) {
	const s = getStacks(actor);
	if (!s) return;
	const wanted = new Set(cardIds);
	const leaving = s.hand.cards.filter((c) => !wanted.has(c.id)).map((c) => c.id);
	if (leaving.length) await s.hand.pass(s.deck, leaving, QUIET);
	const from = { discard: [], vanguard: [], deck: [] };
	for (const id of cardIds) {
		const loc = cardLocation(actor, id);
		if (loc && loc !== 'hand') from[loc].push(id);
	}
	const opts = { updateData: { face: 0 }, ...QUIET };
	if (from.discard.length) await s.discard.pass(s.hand, from.discard, opts);
	if (from.vanguard.length) await s.vanguard.pass(s.hand, from.vanguard, opts);
	if (from.deck.length) await s.deck.pass(s.hand, from.deck, opts);
	// keep the chosen order in the hand window
	const updates = cardIds.map((id, i) => ({ _id: id, sort: i })).filter((u) => s.hand.cards.has(u._id));
	if (updates.length) await s.hand.updateEmbeddedDocuments('Card', updates);
	await s.deck.shuffle(QUIET);
}

/** Start of a conflict: recall everything, shuffle, draw the starting hand. */
export async function setupConflict(actor) {
	const s = getStacks(actor);
	if (!s) return;
	await s.deck.recall(QUIET);
	await s.deck.shuffle(QUIET);
	await drawCards(actor, HAND_SIZE);
}

/** End of a conflict: shuffle all 30 cards back into the deck. */
export async function endConflict(actor) {
	const s = getStacks(actor);
	if (!s) return;
	await s.deck.recall(QUIET);
	await s.deck.shuffle(QUIET);
}

/** Summary used by the GM panel and the hand window. */
export function summarize(actor) {
	const s = getStacks(actor);
	if (!s) return null;
	return {
		deckCount: s.deck.availableCards.length,
		hand: handCards(actor),
		discard: discardCards(actor),
		vanguard: s.vanguard ? s.vanguard.cards.contents : [],
	};
}
