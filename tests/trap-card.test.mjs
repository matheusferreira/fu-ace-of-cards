import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FUID, MODULE_ID } from '../scripts/constants.mjs';

const hooks = new Map();
globalThis.Hooks = {
	once: () => {},
	on: (name, callback) => hooks.set(name, callback),
};
globalThis.foundry = {
	applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (base) => base } },
	utils: { debounce: (fn) => fn, escapeHTML: (value) => value.replaceAll('<', '&lt;') },
};
globalThis.CONST = { TOKEN_DISPOSITIONS: { FRIENDLY: 1, HOSTILE: -1 } };
globalThis.fromUuid = async (uuid) => ({ type: uuid });
const notices = [];
globalThis.ChatMessage = { create: async (data) => notices.push(data), getSpeaker: () => ({}) };
await import('../scripts/main.mjs');

const actor = (uuid, ownerId) => ({
	uuid,
	used: false,
	effects: [],
	items: ownerId ? [{ system: { fuid: FUID.trapCard, level: { value: 1 } } }] : [],
	getFlag: (_, key) => key === 'trapUsed' ? game.actors.get(uuid).used : ownerId && { deck: 'deck', hand: 'hand', discard: 'discard' },
	unsetFlag: async (_, key) => { if (key === 'trapUsed') game.actors.get(uuid).used = false; },
	testUserPermission: (user) => user.id === ownerId,
});
const ace = actor('Actor.ace', 'player');
const enemy = actor('Scene.arena.Token.enemy.Actor.base');
const ally = actor('Actor.ally');
const combatant = (actor, tokenId, disposition) => ({ actor, tokenId, token: { disposition }, name: tokenId });
const caster = combatant(enemy, 'enemy', -1);
const owner = { id: 'player', active: true, isGM: false };
const gm = { id: 'gm', active: true, isGM: true };
const card = (name, damage, joker = false) => ({ name, flags: { [MODULE_ID]: { damage, joker } } });
const hand = [card('2 spades', 'ice'), card('3 hearts', 'fire'), card('4 clubs', 'earth'), card('5 diamonds', 'air'), card('<Joker>', null, true)];
const users = Object.assign([owner, gm, { id: 'other', active: true, isGM: false }], { activeGM: gm });
globalThis.game = {
	actors: new Map([ace, enemy, ally].map((a) => [a.uuid, a])),
	user: gm,
	users,
	cards: new Map([['deck', {}], ['discard', {}], ['hand', { cards: { contents: hand } }]]),
	combat: { started: true, scene: { id: 'arena' }, combatants: [combatant(ace, 'ace', 1), caster, combatant(ally, 'ally', 1)] },
	messages: [],
	settings: { get: () => true },
	i18n: { localize: (key) => key, format: (_, args) => Object.values(args).join(' ') },
};

let id = 0;
function send({ source = caster, itemUuid, action, type = 'display', ...options } = {}) {
	const check = { id: String(++id), actorUuid: source.actor.uuid, itemUuid, type, additionalData: { ruleDefinedAction: action } };
	const message = {
		id: String(id),
		speaker: { scene: 'arena', token: source.tokenId },
		getFlag: (system, key) => system === 'projectfu' && key === 'Check' ? check : undefined,
		...options,
	};
	return hooks.get('createChatMessage')(message);
}

test('only the Ace’s actual ProjectFU turn start clears a spent Trap Card', async () => {
	const event = hooks.get('projectfu.events.combat');
	ace.used = true;
	await event({ type: 'FU.StartOfTurn', actor: enemy });
	await event({ type: 'FU.StartOfRound', actor: ace });
	await send({ itemUuid: 'basic', type: 'accuracy' });
	assert.equal(ace.used, true);
	assert.equal(notices.length, 0);

	await event({ type: 'FU.StartOfTurn', actor: ace });
	assert.equal(ace.used, false);
	await send({ itemUuid: 'basic', type: 'accuracy' });
	assert.equal(notices.length, 1);
	assert.deepEqual(notices[0].whisper, ['player']);
	assert.match(notices[0].content, /2 spades.*&lt;Joker>/);
	assert.doesNotMatch(notices[0].content, /3 hearts|4 clubs|5 diamonds/);
	notices.length = 0;
});

test('matches each action by its data, including non-rolling spells and Skills with accuracy checks', async () => {
	await send({ action: 'objective', type: 'attribute' });
	await send({ itemUuid: 'miscAbility', type: 'accuracy' });
	await send({ itemUuid: 'spell' });
	assert.equal(notices.length, 3);
	for (const [index, name] of ['3 hearts', '4 clubs', '5 diamonds'].entries()) {
		assert.ok(notices[index].content.includes(name));
		assert.match(notices[index].content, /&lt;Joker>/);
	}
	notices.length = 0;
});

test('ignores allies, ordinary checks, and actions the player cannot read or react to', async () => {
	await send({ source: game.combat.combatants[2], itemUuid: 'basic' });
	await send({ type: 'attribute' });
	await send({ itemUuid: 'spell', blind: true });
	await send({ itemUuid: 'spell', whisper: ['other'] });
	caster.token.hidden = true;
	await send({ itemUuid: 'spell' });
	caster.token.hidden = false;
	const previous = hand.splice(1);
	await send({ itemUuid: 'spell' });
	hand.push(...previous);
	assert.equal(notices.length, 0);
});
