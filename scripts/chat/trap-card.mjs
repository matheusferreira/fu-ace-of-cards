import { MODULE_ID, FUID } from '../constants.mjs';
import * as Deck from '../deck/deck-manager.mjs';
import { readAction } from '../bridge/projectfu-bridge.mjs';
import { TRAP_SUIT, swapLimit } from '../rules/sets.mjs';

function findSource(combat, speaker, actorUuid) {
	const candidates = combat.combatants.filter((c) => c.actor?.uuid === actorUuid);
	if (speaker.token) return candidates.find((c) => c.tokenId === speaker.token);
	if (candidates.includes(combat.combatant)) return combat.combatant;
	if (candidates.length === 1) return candidates[0];
	return null;
}

function ownersFor(actor, message) {
	const whisper = message.whisper ?? [];
	const users = game.users.filter((user) =>
		user.active && !user.isGM && actor.testUserPermission(user, 'OWNER')
		&& (!whisper.length || whisper.includes(user.id) || message.author?.id === user.id),
	);
	return users.map((user) => user.id);
}

/** Whisper eligible cards only to active owners who can read the triggering message. */
export async function onEnemyAction(message) {
	const combat = game.combat;
	const speaker = message.speaker;
	if (!combat?.started || !speaker || message.blind) return;
	if (speaker.scene && speaker.scene !== combat.scene?.id) return;

	const event = await readAction(message);
	if (!event || game.combat !== combat || !combat.started) return;
	const { check, action } = event;
	const source = findSource(combat, speaker, check.actorUuid);
	const { FRIENDLY, HOSTILE } = CONST.TOKEN_DISPOSITIONS;
	const disposition = source?.token?.disposition;
	if (source?.hidden || source?.token?.hidden || ![FRIENDLY, HOSTILE].includes(disposition)) return;

	// ProjectFU can create another chat message with the same check id when retargeting it.
	if (game.messages.some((other) => other.id !== message.id && other.getFlag('projectfu', 'Check')?.id === check.id)) return;

	const seen = new Set();
	for (const c of combat.combatants) {
		const actor = c.actor;
		if (!actor || seen.has(actor.uuid) || actor.uuid === source.actor.uuid || c.isDefeated) continue;
		if (c.token?.disposition !== -disposition || actor.getFlag(MODULE_ID, 'trapUsed')) continue;
		const level = Deck.skillLevel(actor, FUID.trapCard);
		if (!level) continue;
		const whisper = ownersFor(actor, message);
		if (!whisper.length) continue;
		const cards = Deck.handCards(actor).filter((card) => {
			const rule = Deck.toRuleCard(card);
			return rule.joker || rule.suit === TRAP_SUIT[action];
		});
		if (!cards.length) continue;
		seen.add(actor.uuid);
		const escape = foundry.utils.escapeHTML;
		const hint = game.i18n.format('FUAOC.Swap.trapAvailable', {
			enemy: escape(source.name),
			action: game.i18n.localize(`FUAOC.Action.${action}`),
			max: swapLimit(level),
		});
		const list = cards.map((card) => `<li>${escape(card.name)}</li>`).join('');
		await ChatMessage.create({
			speaker: ChatMessage.getSpeaker({ actor, token: c.token, scene: combat.scene }),
			whisper,
			content: `<div class="fuaoc-chat"><header><h3>Trap Card</h3></header><p>${hint}</p><ul>${list}</ul></div>`,
		});
	}
}
