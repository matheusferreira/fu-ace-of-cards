import { SOCKET } from './constants.mjs';

/**
 * Minimal request/response over the module socket. Handlers registered here run on the active GM client.
 */
const handlers = new Map();
const pending = new Map();

export function registerHandler(action, fn) {
	handlers.set(action, fn);
}

function isResponsibleGM() {
	return game.user.isGM && game.users.activeGM?.id === game.user.id;
}

export function initSocket() {
	game.socket.on(SOCKET, async (msg) => {
		if (!msg) return;
		if (msg.type === 'response' && msg.to === game.user.id) {
			const p = pending.get(msg.requestId);
			if (!p) return;
			pending.delete(msg.requestId);
			if (msg.error) p.reject(new Error(msg.error));
			else p.resolve(msg.result);
			return;
		}
		if (msg.type === 'request' && isResponsibleGM()) {
			const fn = handlers.get(msg.action);
			let result = null;
			let error = null;
			try {
				if (!fn) throw new Error(`Unknown action ${msg.action}`);
				const user = game.users.get(msg.from);
				result = await fn(msg.data, user);
			} catch (e) {
				console.error(e);
				error = e.message;
			}
			game.socket.emit(SOCKET, { type: 'response', to: msg.from, requestId: msg.requestId, result, error });
		}
	});
}

/** Run an action on the GM client (or locally if this user is the responsible GM). */
export async function requestGM(action, data) {
	if (isResponsibleGM()) {
		const fn = handlers.get(action);
		if (!fn) throw new Error(`Unknown action ${action}`);
		return fn(data, game.user);
	}
	if (!game.users.activeGM) {
		ui.notifications.warn(game.i18n.localize('FUAOC.Notify.noGM'));
		throw new Error('No active GM');
	}
	const requestId = foundry.utils.randomID();
	return new Promise((resolve, reject) => {
		pending.set(requestId, { resolve, reject });
		game.socket.emit(SOCKET, { type: 'request', from: game.user.id, requestId, action, data });
		setTimeout(() => {
			if (pending.has(requestId)) {
				pending.delete(requestId);
				reject(new Error('GM did not respond'));
			}
		}, 20000);
	});
}
