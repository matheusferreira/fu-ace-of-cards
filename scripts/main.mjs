import { MODULE_ID, FLAGS, FUID } from './constants.mjs';
import { registerSettings, getSetting, SETTINGS } from './settings.mjs';
import { initSocket, registerHandler, requestGM } from './socket.mjs';
import * as Deck from './deck/deck-manager.mjs';
import * as Proposal from './chat/proposal.mjs';
import * as Bridge from './bridge/projectfu-bridge.mjs';
import { HandApp, handActorForUser } from './apps/hand-app.mjs';
import { GMPanel } from './apps/gm-panel.mjs';
import * as Sets from './rules/sets.mjs';
import * as Resolution from './rules/resolution.mjs';

const isResponsibleGM = () => game.user.isGM && game.users.activeGM?.id === game.user.id;

Hooks.once('init', () => {
	registerSettings();
	Bridge.registerDoubleOrNothing(MODULE_ID);
	game.keybindings.register(MODULE_ID, 'openHand', {
		name: 'FUAOC.Keybinding.openHand',
		editable: [{ key: 'KeyH', modifiers: ['Shift'] }],
		onDown: () => {
			openHandForCurrentUser();
			return true;
		},
	});
	game.keybindings.register(MODULE_ID, 'openPanel', {
		name: 'FUAOC.Keybinding.openPanel',
		editable: [{ key: 'KeyG', modifiers: ['Shift'] }],
		restricted: true,
		onDown: () => {
			GMPanel.open();
			return true;
		},
	});
});

function openHandForCurrentUser() {
	let actor = handActorForUser();
	if (!actor && game.user.isGM) {
		// GM: the selected token's actor, or the only Ace of Cards character in the world
		const controlled = canvas?.tokens?.controlled?.map((t) => t.actor).find((a) => a && Deck.isAce(a));
		const aces = Deck.aceActors();
		actor = controlled ?? (aces.length === 1 ? aces[0] : null);
	}
	if (actor) return HandApp.open(actor);
	if (game.user.isGM) return GMPanel.open();
	ui.notifications.info(game.i18n.localize('FUAOC.Notify.noAce'));
}

async function actorFrom(data) {
	const actor = await fromUuid(data.actorUuid);
	if (!actor) throw new Error('Actor not found');
	return actor;
}

Hooks.once('ready', () => {
	initSocket();
	registerHandler('ensureStacks', async (data) => {
		await Deck.ensureStacks(await actorFrom(data));
		return true;
	});
	registerHandler('setupConflict', async (data) => {
		await Deck.setupConflict(await actorFrom(data));
		return true;
	});
	registerHandler('applyProposal', async (data) => {
		await Proposal.applyProposal(data.messageId);
		return true;
	});

	game.modules.get(MODULE_ID).api = { Deck, Sets, Resolution, Proposal, Bridge, HandApp, GMPanel, openHand: openHandForCurrentUser };
	console.log(`${MODULE_ID} | ready`);
});

/* Auto-create stacks when a character gains the Magic Cards skill (GM client). */
Hooks.on('createItem', async (item) => {
	if (!isResponsibleGM()) return;
	if (item.system?.fuid !== FUID.magicCards || !item.parent || item.parent.documentName !== 'Actor') return;
	if (!Deck.getStacks(item.parent)) await Deck.ensureStacks(item.parent);
	GMPanel.refresh();
});

/* Keep stack ownership in sync with the actor's owners. */
Hooks.on('updateActor', async (actor, changes) => {
	if (!isResponsibleGM() || !changes.ownership) return;
	await Deck.syncOwnership(actor);
});

/* Conflicts: shuffle and draw 5 at the start, recall all cards at the end. */
Hooks.on('combatStart', async (combat) => {
	if (!isResponsibleGM() || !getSetting(SETTINGS.autoSetupConflict)) return;
	for (const c of combat.combatants) {
		if (c.actor && Deck.getStacks(c.actor)) await Deck.setupConflict(c.actor);
	}
	GMPanel.refresh();
});
Hooks.on('deleteCombat', async (combat) => {
	if (!isResponsibleGM() || !getSetting(SETTINGS.autoSetupConflict)) return;
	for (const c of combat.combatants) {
		if (c.actor && Deck.getStacks(c.actor)) {
			await Deck.endConflict(c.actor);
			await Bridge.clearTemporaryEffects(c.actor, MODULE_ID);
		}
	}
	GMPanel.refresh();
});
/* High or Low lasts until the start of the actor's next turn. */
Hooks.on('updateCombat', async (combat, changes) => {
	if (!isResponsibleGM() || !('turn' in changes || 'round' in changes)) return;
	// Card Vanguard resistances last until the end of the turn.
	for (const c of combat.combatants) if (c.actor) await Bridge.clearTurnEndEffects(c.actor, MODULE_ID);
	const actor = combat.combatant?.actor;
	if (!actor) return;
	await Bridge.clearTemporaryEffects(actor, MODULE_ID);
	// Trap Card can be used again from the start of the actor's next turn.
	if (actor.getFlag(MODULE_ID, 'trapUsed')) await actor.unsetFlag(MODULE_ID, 'trapUsed');
});
Hooks.on('deleteCombat', async (combat) => {
	if (!isResponsibleGM()) return;
	for (const c of combat.combatants) {
		if (!c.actor) continue;
		if (c.actor.getFlag(MODULE_ID, 'trapUsed')) await c.actor.unsetFlag(MODULE_ID, 'trapUsed');
		await Bridge.clearTurnEndEffects(c.actor, MODULE_ID);
	}
});

/* Re-render windows when any of the module's card stacks change. */
const dirty = new Set();
const flush = foundry.utils.debounce(() => {
	for (const uuid of dirty) HandApp.refreshFor(uuid);
	dirty.clear();
	GMPanel.refresh();
}, 80);
function onCardsChanged(doc) {
	const cards = doc.documentName === 'Card' ? doc.parent : doc;
	const uuid = cards?.getFlag?.(MODULE_ID, FLAGS.stackActor);
	if (!uuid) return;
	dirty.add(uuid);
	flush();
}
for (const h of ['createCard', 'updateCard', 'deleteCard', 'updateCards']) Hooks.on(h, onCardsChanged);
Hooks.on('updateActor', (actor) => {
	HandApp.refreshFor(actor.uuid);
	GMPanel.refresh();
});

Hooks.on('renderChatMessageHTML', Proposal.onRenderChatMessage);

/* Buttons in the Cards sidebar and in the token controls. */
Hooks.on('renderCardsDirectory', (app, html) => {
	const root = html instanceof HTMLElement ? html : html[0];
	if (root.querySelector('.fuaoc-directory')) return;
	const bar = document.createElement('div');
	bar.className = 'fuaoc-directory action-buttons flexrow';
	bar.innerHTML = `<button type="button" data-fuaoc="hand"><i class="fa-solid fa-diamond"></i> ${game.i18n.localize('FUAOC.Hand.title')}</button>`;
	if (game.user.isGM) bar.innerHTML += `<button type="button" data-fuaoc="panel"><i class="fa-solid fa-crown"></i> ${game.i18n.localize('FUAOC.GM.title')}</button>`;
	bar.querySelector('[data-fuaoc=hand]').addEventListener('click', () => openHandForCurrentUser());
	bar.querySelector('[data-fuaoc=panel]')?.addEventListener('click', () => GMPanel.open());
	const header = root.querySelector('.directory-header') ?? root;
	header.prepend(bar);
});

Hooks.on('getSceneControlButtons', (controls) => {
	try {
		const tokens = controls.tokens ?? controls.token;
		if (!tokens?.tools) return;
		tokens.tools.fuaocHand = {
			name: 'fuaocHand',
			title: 'FUAOC.Hand.title',
			icon: 'fa-solid fa-diamond',
			order: 99,
			button: true,
			visible: true,
			onChange: () => openHandForCurrentUser(),
		};
	} catch (e) {
		console.warn(`${MODULE_ID} | scene control not added`, e);
	}
});
