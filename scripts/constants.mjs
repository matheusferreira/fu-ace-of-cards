export const MODULE_ID = 'fu-ace-of-cards';
export const SOCKET = `module.${MODULE_ID}`;
export const TEMPLATES = `modules/${MODULE_ID}/templates`;
export const ASSETS = `modules/${MODULE_ID}/assets`;

/** projectfu item identifiers (system.fuid) */
export const FUID = {
	class: 'ace-of-cards',
	magicCards: 'magic-cards',
	highOrLow: 'high-or-low',
	mulligan: 'mulligan',
	trapCard: 'trap-card',
	doubleOrNothing: 'double-or-nothing',
	cardVanguard: 'card-vanguard',
	forbiddenRite: 'forbidden-rite',
	blackWhite: 'black-white',
	duelMaster: 'duel-master',
};

/** Flag keys stored under flags[MODULE_ID] */
export const FLAGS = {
	actorStacks: 'stacks', // on Actor: {deck, hand, discard, vanguard} Cards ids
	actorConfig: 'config', // on Actor: {preset, suitMap, names}
	stackRole: 'role', // on Cards: 'deck' | 'hand' | 'discard' | 'vanguard'
	stackActor: 'actor', // on Cards: actor uuid
	cardJoker: 'joker', // on Card: boolean
	cardSuitKey: 'suitKey', // on Card: preset suit key (e.g. 'hearts', 'cups')
	proposal: 'proposal', // on ChatMessage
};

export const SUIT_KEYS = ['s1', 's2', 's3', 's4'];
export const DAMAGE_TYPES = ['air', 'earth', 'fire', 'ice'];
export const HAND_SIZE = 5;
