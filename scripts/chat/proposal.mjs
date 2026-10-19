import { MODULE_ID, FLAGS, TEMPLATES } from '../constants.mjs';
import { modeFor, canApprove } from '../settings.mjs';
import * as Bridge from '../bridge/projectfu-bridge.mjs';
import { requestGM } from '../socket.mjs';
import * as Deck from '../deck/deck-manager.mjs';

/**
 * A proposal is a chat message describing one resolution (set effect, High or Low...) with its parts.
 * parts: [{ kind: 'damage'|'recovery'|'status'|'mp'|'note', targets: [actorUuid], amount, type, resource,
 *           statuses, active, ignoreResistances, label }]
 */

const L = (k, d) => game.i18n.format(`FUAOC.${k}`, d ?? {});

function tokenActor(t) {
	return t?.actor ?? null;
}

function combatantsOf() {
	return game.combat?.combatants?.contents ?? [];
}

function dispositionOf(actor) {
	const tok = actor.getActiveTokens()[0] ?? actor.prototypeToken;
	return tok?.document?.disposition ?? tok?.disposition ?? CONST.TOKEN_DISPOSITIONS.FRIENDLY;
}

/** "Every enemy you can see": hostile combatants (or targeted tokens outside combat). */
export function defaultEnemies(actor) {
	const mine = dispositionOf(actor);
	const fromCombat = combatantsOf()
		.filter((c) => c.actor && !c.isDefeated && c.token && c.token.disposition !== mine && c.token.disposition !== CONST.TOKEN_DISPOSITIONS.NEUTRAL)
		.map((c) => c.actor);
	if (fromCombat.length) return fromCombat;
	return [...game.user.targets].map(tokenActor).filter((a) => a && a !== actor);
}

/** "You and every ally you can see". */
export function defaultAllies(actor) {
	const mine = dispositionOf(actor);
	const fromCombat = combatantsOf()
		.filter((c) => c.actor && c.token && c.token.disposition === mine)
		.map((c) => c.actor);
	const set = new Set([actor, ...fromCombat]);
	return [...set];
}

export function targetedActors() {
	return [...game.user.targets].map(tokenActor).filter(Boolean);
}

/** Whether every part of a proposal can skip approval under the current settings. */
function needsApproval(parts) {
	return parts.some((p) => p.kind !== 'note' && modeFor(p.kind) === 'approve');
}

/**
 * Create the chat card for a resolution and auto-apply it when settings allow.
 * @param {object} p
 * @param {Actor} p.actor
 * @param {string} p.title
 * @param {string} p.summary   one line description
 * @param {Array} p.cards      [{img,name}]
 * @param {Array} p.parts
 * @param {object} [p.undo]    {discarded:[ids], drawn:[ids], mp}
 */
export async function createProposal({ actor, title, summary, cards = [], parts, undo = null, tags = [] }) {
	const approval = needsApproval(parts);
	const data = {
		actorUuid: actor.uuid,
		title,
		summary,
		cards,
		parts: parts.map((p) => ({ ...p, targets: (p.targets ?? []).map((a) => (typeof a === 'string' ? a : a.uuid)) })),
		undo,
		tags,
		status: approval ? 'pending' : 'applying',
		snapshot: null,
		createdBy: game.user.id,
	};
	const content = await renderProposal(data);
	const msg = await ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor }),
		content,
		flags: { [MODULE_ID]: { [FLAGS.proposal]: data } },
	});
	if (!approval) await requestGM('applyProposal', { messageId: msg.id });
	return msg;
}

async function describeTargets(uuids) {
	const names = [];
	for (const u of uuids) {
		const a = await fromUuid(u);
		if (a) names.push(a.name);
	}
	return names.join(', ') || '—';
}

export async function renderProposal(data) {
	const parts = [];
	for (const p of data.parts) {
		parts.push({ ...p, targetNames: await describeTargets(p.targets), typeLabel: p.type ? game.i18n.localize(`FU.Damage${p.type.capitalize()}`) : '' });
	}
	return foundry.applications.handlebars.renderTemplate(`${TEMPLATES}/chat-proposal.hbs`, {
		...data,
		parts,
		isPending: data.status === 'pending',
		isApplied: data.status === 'applied',
		isRejected: data.status === 'rejected',
		isReverted: data.status === 'reverted',
	});
}

async function updateMessage(message, patch) {
	const data = foundry.utils.mergeObject(foundry.utils.deepClone(message.getFlag(MODULE_ID, FLAGS.proposal)), patch, { inplace: false });
	const content = await renderProposal(data);
	await message.update({ content, [`flags.${MODULE_ID}.${FLAGS.proposal}`]: data });
	return data;
}

async function resolveActors(uuids) {
	const out = [];
	for (const u of uuids) {
		const a = await fromUuid(u);
		if (a) out.push(a);
	}
	return out;
}

/** GM side: apply every part of a proposal. */
export async function applyProposal(messageId) {
	const message = game.messages.get(messageId);
	const data = message?.getFlag(MODULE_ID, FLAGS.proposal);
	if (!data || data.status === 'applied') return;
	const source = await fromUuid(data.actorUuid);
	const allTargets = new Set();
	for (const p of data.parts) for (const u of p.targets) allTargets.add(u);
	const snapshot = Bridge.snapshot(await resolveActors([...allTargets, data.actorUuid]));
	for (const p of data.parts) {
		const targets = await resolveActors(p.targets);
		switch (p.kind) {
			case 'damage':
				await Bridge.dealDamage(source, targets, p.amount, p.type, { name: data.title, ignoreResistances: p.ignoreResistances, ignoreImmunities: p.ignoreImmunities });
				break;
			case 'recovery':
				await Bridge.recover(source, targets, p.resource, p.amount, { name: data.title });
				break;
			case 'mp':
				await Bridge.spendMP(source, p.amount, { name: data.title });
				break;
			case 'status':
				await Bridge.setStatuses(targets, p.statuses, p.active);
				break;
			case 'effect':
				for (const t of targets) await Bridge.addTemporaryEffect(t, { ...p.effect, moduleId: MODULE_ID });
				break;
			default:
				break;
		}
	}
	await updateMessage(message, { status: 'applied', snapshot, appliedBy: game.user.id });
}

/** GM side: reject = undo the card movement and keep MP untouched. */
export async function rejectProposal(messageId) {
	const message = game.messages.get(messageId);
	const data = message?.getFlag(MODULE_ID, FLAGS.proposal);
	if (!data || data.status !== 'pending') return;
	const actor = await fromUuid(data.actorUuid);
	if (data.undo && actor) {
		if (data.undo.drawn?.length) await Deck.returnToDeck(actor, data.undo.drawn.filter((id) => Deck.getStacks(actor)?.hand.cards.has(id)));
		if (data.undo.discarded?.length) await Deck.reclaimToHand(actor, data.undo.discarded);
		if (data.undo.mpSpent) await Bridge.recover(actor, [actor], 'mp', data.undo.mpSpent, { name: data.title });
	}
	await updateMessage(message, { status: 'rejected' });
}

/** GM side: restore HP/MP/statuses captured before applying. */
export async function revertProposal(messageId) {
	const message = game.messages.get(messageId);
	const data = message?.getFlag(MODULE_ID, FLAGS.proposal);
	if (!data || data.status !== 'applied' || !data.snapshot) return;
	await Bridge.restore(data.snapshot);
	await updateMessage(message, { status: 'reverted' });
}

/** GM side: replace the targets of every part that targets enemies with the GM's current targets. */
export async function retargetProposal(messageId, uuids) {
	const message = game.messages.get(messageId);
	const data = message?.getFlag(MODULE_ID, FLAGS.proposal);
	if (!data || data.status !== 'pending') return;
	const parts = data.parts.map((p) => (p.enemyTargets ? { ...p, targets: uuids } : p));
	const content = await renderProposal({ ...data, parts });
	await message.update({ content, [`flags.${MODULE_ID}.${FLAGS.proposal}.parts`]: parts });
}

/** Bind the chat card buttons. */
export function onRenderChatMessage(message, html) {
	const data = message.getFlag(MODULE_ID, FLAGS.proposal);
	if (!data) return;
	const root = html instanceof HTMLElement ? html : html[0];
	root.querySelectorAll('[data-fuaoc-action]').forEach((btn) => {
		if (!canApprove()) {
			btn.remove();
			return;
		}
		btn.addEventListener('click', async (ev) => {
			ev.preventDefault();
			btn.disabled = true;
			const action = btn.dataset.fuaocAction;
			try {
				if (action === 'approve') await applyProposal(message.id);
				else if (action === 'reject') await rejectProposal(message.id);
				else if (action === 'revert') await revertProposal(message.id);
				else if (action === 'retarget') {
					const uuids = targetedActors().map((a) => a.uuid);
					if (!uuids.length) ui.notifications.warn(L('Notify.noTargets'));
					else await retargetProposal(message.id, uuids);
				}
			} catch (e) {
				console.error(e);
				ui.notifications.error(e.message);
			} finally {
				btn.disabled = false;
			}
		});
	});
}
