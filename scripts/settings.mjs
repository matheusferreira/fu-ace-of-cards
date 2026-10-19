import { MODULE_ID } from './constants.mjs';

export const SETTINGS = {
	damageMode: 'damageMode',
	recoveryMode: 'recoveryMode',
	statusMode: 'statusMode',
	mpMode: 'mpMode',
	reactionHints: 'reactionHints',
	approvers: 'approvers',
	autoSetupConflict: 'autoSetupConflict',
};

const MODES = () => ({ approve: game.i18n.localize('FUAOC.Settings.mode.approve'), auto: game.i18n.localize('FUAOC.Settings.mode.auto') });

export function registerSettings() {
	const mode = (key, def) =>
		game.settings.register(MODULE_ID, key, {
			name: `FUAOC.Settings.${key}.name`,
			hint: `FUAOC.Settings.${key}.hint`,
			scope: 'world',
			config: true,
			type: String,
			choices: MODES(),
			default: def,
			onChange: () => Hooks.callAll(`${MODULE_ID}.settingsChanged`),
		});
	mode(SETTINGS.damageMode, 'approve');
	mode(SETTINGS.recoveryMode, 'approve');
	mode(SETTINGS.statusMode, 'approve');
	mode(SETTINGS.mpMode, 'auto');
	game.settings.register(MODULE_ID, SETTINGS.approvers, {
		name: 'FUAOC.Settings.approvers.name',
		hint: 'FUAOC.Settings.approvers.hint',
		scope: 'world',
		config: true,
		type: String,
		choices: { gm: game.i18n.localize('FUAOC.Settings.approvers.gm'), assistant: game.i18n.localize('FUAOC.Settings.approvers.assistant') },
		default: 'gm',
	});
	game.settings.register(MODULE_ID, SETTINGS.reactionHints, {
		name: 'FUAOC.Settings.reactionHints.name',
		hint: 'FUAOC.Settings.reactionHints.hint',
		scope: 'world',
		config: true,
		type: Boolean,
		default: true,
	});
	game.settings.register(MODULE_ID, SETTINGS.autoSetupConflict, {
		name: 'FUAOC.Settings.autoSetupConflict.name',
		hint: 'FUAOC.Settings.autoSetupConflict.hint',
		scope: 'world',
		config: true,
		type: Boolean,
		default: true,
	});
}

export function getSetting(key) {
	return game.settings.get(MODULE_ID, key);
}

/** Mode for a kind of effect: 'approve' | 'auto' */
export function modeFor(kind) {
	switch (kind) {
		case 'damage':
			return getSetting(SETTINGS.damageMode);
		case 'recovery':
			return getSetting(SETTINGS.recoveryMode);
		case 'status':
		case 'resistance':
			return getSetting(SETTINGS.statusMode);
		case 'mp':
			return getSetting(SETTINGS.mpMode);
		default:
			return 'auto';
	}
}

export function canApprove(user = game.user) {
	if (user.isGM && user.role >= CONST.USER_ROLES.GAMEMASTER) return true;
	return getSetting(SETTINGS.approvers) === 'assistant' && user.role >= CONST.USER_ROLES.ASSISTANT;
}
