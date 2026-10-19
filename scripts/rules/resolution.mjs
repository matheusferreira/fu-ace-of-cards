import { FUID, MODULE_ID } from '../constants.mjs';
import { findSets, computeEffect, highOrLow, maxCards, MIN_CARDS, mpCost } from './sets.mjs';
import * as Deck from '../deck/deck-manager.mjs';
import * as Bridge from '../bridge/projectfu-bridge.mjs';
import { modeFor } from '../settings.mjs';
import { createProposal, defaultAllies, defaultEnemies, targetedActors } from '../chat/proposal.mjs';

const L = (k, d) => game.i18n.format(`FUAOC.${k}`, d ?? {});

export function ruleOptions(actor) {
	return {
		forbiddenRite: Deck.hasHeroic(actor, FUID.forbiddenRite),
		blackWhite: Deck.hasHeroic(actor, FUID.blackWhite),
		duelMaster: Deck.hasHeroic(actor, FUID.duelMaster),
	};
}

/** Sets available for the selected hand cards (ids in selection order). */
export function optionsFor(actor, ids) {
	const hand = Deck.handCards(actor);
	const cards = ids.map((id) => hand.find((c) => c.id === id)).filter(Boolean).map(Deck.toRuleCard);
	return findSets(cards, ruleOptions(actor));
}

export function effectLabel(option) {
	const base = game.i18n.localize(`FUAOC.Effect.${option.effect}.name`);
	if (option.variant && option.variant !== 'any') return `${base} (${game.i18n.localize(`FUAOC.Variant.${option.variant}`)})`;
	return base;
}

/**
 * Validate a Magic Cards resolution before touching anything.
 * @returns {string|null} error message
 */
export function validate(actor, ids) {
	const sl = Deck.skillLevel(actor, FUID.magicCards);
	if (!sl) return L('Error.noSkill');
	const max = maxCards(sl);
	if (ids.length < MIN_CARDS || ids.length > max) return L('Error.cardCount', { min: MIN_CARDS, max });
	const mp = actor.system?.resources?.mp?.value ?? 0;
	if (mp < mpCost(ids.length)) return L('Error.noMP', { cost: mpCost(ids.length), mp });
	return null;
}

/**
 * Resolve Magic Cards: pay MP, discard the set, draw the same number, post the proposal.
 * @param {Actor} actor
 * @param {string[]} ids        selected hand card ids, in the order chosen
 * @param {object|null} option  an entry from findSets (null = discard without effect)
 * @param {object} choices      { type, statuses: string[] }
 */
export async function resolveMagicCards(actor, ids, option, choices = {}) {
	const err = validate(actor, ids);
	if (err) {
		ui.notifications.warn(err);
		return null;
	}
	const hand = Deck.handCards(actor);
	const played = ids.map((id) => hand.find((c) => c.id === id));
	const ruleCards = played.map(Deck.toRuleCard);
	const cost = mpCost(ids.length);
	const parts = [];
	let mpSpent = 0;
	if (modeFor('mp') === 'auto') {
		await Bridge.spendMP(actor, cost, { name: 'Magic Cards' });
		mpSpent = cost;
	} else {
		parts.push({ kind: 'mp', amount: cost, targets: [actor], label: L('Part.mp', { cost }) });
	}

	const beforeHand = new Set(Deck.handCards(actor).map((c) => c.id));
	await Deck.discardFromHand(actor, ids);
	await Deck.drawCards(actor, ids.length);
	const drawn = Deck.handCards(actor).map((c) => c.id).filter((id) => !beforeHand.has(id));

	const opts = ruleOptions(actor);
	const jokerInDiscard = Deck.discardCards(actor).some((c) => c.getFlag(MODULE_ID, 'joker'));
	const level = Deck.actorLevel(actor);
	let title = L('Effect.none');
	let summary = '';
	if (option) {
		const fx = computeEffect(option, { level });
		title = effectLabel(option);
		summary = game.i18n.localize(`FUAOC.Effect.${option.effect}.text`);
		const ignore = (option.effect === 'forbiddenMonarch' && jokerInDiscard) || (opts.blackWhite && jokerInDiscard && ['blindingFlush', 'doubleTrouble', 'magicFlush'].includes(option.effect));
		switch (fx.kind) {
			case 'damage': {
				const type = choices.type ?? fx.type ?? fx.typeChoices?.[0];
				const targets = fx.target === 'upToTwoEnemies' ? targetedActors().slice(0, 2) : defaultEnemies(actor);
				parts.push({ kind: 'damage', amount: fx.amount, type, targets, enemyTargets: true, ignoreResistances: ignore, ignoreImmunities: ignore, label: L('Part.damage', { amount: fx.amount }) });
				break;
			}
			case 'recovery':
				parts.push({ kind: 'recovery', resource: 'hp', amount: fx.hp, targets: defaultAllies(actor), label: L('Part.recoverHP', { amount: fx.hp }) });
				if (fx.mp) parts.push({ kind: 'recovery', resource: 'mp', amount: fx.mp, targets: defaultAllies(actor), label: L('Part.recoverMP', { amount: fx.mp }) });
				break;
			case 'status': {
				const statuses = (choices.statuses ?? []).slice(0, 2);
				const remove = fx.mode === 'remove';
				parts.push({
					kind: 'status',
					statuses,
					active: !remove,
					targets: remove ? defaultAllies(actor) : defaultEnemies(actor),
					enemyTargets: !remove,
					label: L(remove ? 'Part.statusRemove' : 'Part.statusInflict', { list: statuses.map((s) => game.i18n.localize(`FU.${s.capitalize()}`)).join(', ') }),
				});
				break;
			}
			case 'freeAttack': {
				const type = choices.type ?? fx.typeChoices[0];
				let extra = '';
				if (opts.duelMaster) extra = ' ' + L('Part.duelMaster', { dmg: fx.pairValue, mp: fx.pairValue * 2 });
				parts.push({ kind: 'note', targets: [], label: L('Part.freeAttack', { type: game.i18n.localize(`FU.Damage${type.capitalize()}`) }) + extra });
				if (opts.duelMaster) parts.push({ kind: 'recovery', resource: 'mp', amount: fx.pairValue * 2, targets: [actor], label: L('Part.recoverMP', { amount: fx.pairValue * 2 }) });
				break;
			}
			default:
				break;
		}
	}

	// High or Low
	const hol = highOrLow(ruleCards, Deck.skillLevel(actor, FUID.highOrLow));
	if (hol && option) {
		if (hol.heal) parts.push({ kind: 'recovery', resource: 'hp', amount: hol.heal, targets: [actor], label: L('Part.highOrLowHeal', { amount: hol.heal }) });
		if (hol.extraDamage || hol.damageReduction) {
			parts.push({
				kind: 'effect',
				targets: [actor],
				effect: { name: 'High or Low', extraDamage: hol.extraDamage, damageReduction: hol.damageReduction },
				label: L('Part.highOrLow', { dmg: hol.extraDamage, red: hol.damageReduction }),
			});
		}
	}

	const cards = played.map((c) => ({ img: c.img, name: c.name }));
	return createProposal({
		actor,
		title,
		summary,
		cards,
		parts,
		undo: { discarded: ids, drawn, mpSpent },
		tags: ['magic-cards'],
	});
}
