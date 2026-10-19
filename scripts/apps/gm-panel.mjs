import { TEMPLATES, FUID } from '../constants.mjs';
import * as Deck from '../deck/deck-manager.mjs';
import { HandApp } from './hand-app.mjs';
import { SETTINGS, getSetting } from '../settings.mjs';
import { MODULE_ID, FLAGS } from '../constants.mjs';
import { availablePresets, defaultConfig } from '../deck/presets.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
let instance = null;

/** GM overview: every Ace of Cards actor, its hand (faces visible), deck and discard. */
export class GMPanel extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: 'fuaoc-gm-panel',
		classes: ['fuaoc', 'fuaoc-gm'],
		window: { title: 'FUAOC.GM.title', icon: 'fa-solid fa-crown', resizable: true },
		position: { width: 760, height: 'auto' },
		actions: {
			create: GMPanel.#act('create'),
			rebuild: GMPanel.#act('rebuild'),
			setup: GMPanel.#act('setup'),
			end: GMPanel.#act('end'),
			draw: GMPanel.#act('draw'),
			recycle: GMPanel.#act('recycle'),
			shuffle: GMPanel.#act('shuffle'),
			openHand: GMPanel.#act('openHand'),
			toggleMode: GMPanel.#toggleMode,
			setHand: GMPanel.#setHand,
		},
	};

	static PARTS = { body: { template: `${TEMPLATES}/gm-panel.hbs` } };

	static open() {
		if (!game.user.isGM) return null;
		instance ??= new GMPanel();
		instance.render({ force: true });
		return instance;
	}

	static refresh() {
		if (instance?.rendered) instance.render();
	}

	_onRender(context, options) {
		super._onRender(context, options);
		this.element.querySelectorAll('select[name=preset]').forEach((el) =>
			el.addEventListener('change', async (ev) => {
				const actor = game.actors.get(ev.target.closest('[data-actor-id]').dataset.actorId);
				const cfg = defaultConfig(ev.target.value);
				await actor.setFlag(MODULE_ID, FLAGS.actorConfig, cfg);
				if (Deck.getStacks(actor)) await Deck.ensureStacks(actor, { rebuild: true });
				ui.notifications.info(game.i18n.format('FUAOC.GM.presetChanged', { name: actor.name }));
				this.render();
			}),
		);
	}

	_onClose(options) {
		instance = null;
		super._onClose(options);
	}

	async _prepareContext() {
		const modes = ['damageMode', 'recoveryMode', 'statusMode', 'mpMode'].map((key) => ({
			key,
			label: game.i18n.localize(`FUAOC.Settings.${key}.name`),
			auto: getSetting(SETTINGS[key]) === 'auto',
		}));
		const actors = Deck.aceActors().map((a) => {
			const sum = Deck.summarize(a);
			const preset = Deck.getConfig(a).preset;
			return {
				presets: availablePresets().map((p) => ({ ...p, selected: p.key === preset })),
				id: a.id,
				uuid: a.uuid,
				name: a.name,
				img: a.img,
				sl: Deck.skillLevel(a, FUID.magicCards),
				mp: a.system?.resources?.mp?.value ?? 0,
				hasStacks: !!sum,
				deckCount: sum?.deckCount ?? 0,
				hand: sum?.hand.map((c) => ({ img: c.img, name: c.name })) ?? [],
				discardCount: sum?.discard.length ?? 0,
				discardTop: sum?.discard.at(-1)?.img ?? null,
				vanguardCount: sum?.vanguard.length ?? 0,
			};
		});
		return { actors, modes, inCombat: !!game.combat?.started };
	}

	static #act(kind) {
		return async function (event, target) {
			const actor = game.actors.get(target.closest('[data-actor-id]')?.dataset.actorId);
			if (!actor) return;
			const s = Deck.getStacks(actor);
			switch (kind) {
				case 'create':
					await Deck.ensureStacks(actor);
					break;
				case 'rebuild':
					await Deck.ensureStacks(actor, { rebuild: true });
					break;
				case 'setup':
					await Deck.setupConflict(actor);
					break;
				case 'end':
					await Deck.endConflict(actor);
					break;
				case 'draw':
					await Deck.drawCards(actor, 1);
					break;
				case 'recycle':
					await Deck.recycleDiscard(actor);
					break;
				case 'shuffle':
					if (s) await s.deck.shuffle({ chatNotification: false });
					break;
				case 'openHand':
					HandApp.open(actor);
					break;
			}
			if (kind !== 'openHand') {
				await ChatMessage.create({
					content: `<p><strong>Ace of Cards</strong> — ${game.i18n.localize(`FUAOC.GM.log.${kind}`)}: ${actor.name}</p>`,
					whisper: ChatMessage.getWhisperRecipients('GM'),
				});
			}
			this.render();
		};
	}

	/** Testing tool: pick the exact cards in an actor's hand, without RNG. */
	static async #setHand(event, target) {
		const actor = game.actors.get(target.closest('[data-actor-id]')?.dataset.actorId);
		if (!actor || !Deck.getStacks(actor)) return;
		const L = (k) => game.i18n.localize(`FUAOC.SetHand.${k}`);
		const cards = Deck.allCards(actor);
		const items = cards
			.map(
				(c) => `<label class="fuaoc-pick loc-${c.location}" data-tooltip="${c.name} · ${L(c.location)}">
					<input type="checkbox" name="card" value="${c.id}" ${c.location === 'hand' ? 'checked' : ''}>
					<img src="${c.img}" alt=""><span class="fuaoc-cname">${c.name}</span><span class="fuaoc-loc">${L(c.location)}</span></label>`,
			)
			.join('');
		const ids = await foundry.applications.api.DialogV2.wait({
			window: { title: `${L('title')} — ${actor.name}`, resizable: true },
			position: { width: 760 },
			classes: ['fuaoc', 'fuaoc-dialog', 'fuaoc-sethand'],
			content: `<p>${L('text')}</p><div class="fuaoc-picks">${items}</div>`,
			buttons: [
				{ action: 'ok', label: L('confirm'), icon: 'fa-solid fa-hand', default: true, callback: (ev, button) => [...button.form.querySelectorAll('input[name=card]:checked')].map((i) => i.value) },
				{ action: 'cancel', label: L('cancel'), callback: () => null },
			],
			rejectClose: false,
		});
		if (!Array.isArray(ids)) return;
		await Deck.setHand(actor, ids);
		const names = Deck.handCards(actor).map((c) => c.name).join(', ') || '—';
		await ChatMessage.create({
			content: `<p><strong>Ace of Cards</strong> — ${game.i18n.localize('FUAOC.GM.log.setHand')}: ${actor.name} (${names})</p>`,
			whisper: ChatMessage.getWhisperRecipients('GM'),
		});
		this.render();
	}

	static async #toggleMode(event, target) {
		const key = target.dataset.key;
		const now = game.settings.get(MODULE_ID, key);
		await game.settings.set(MODULE_ID, key, now === 'auto' ? 'approve' : 'auto');
		this.render();
	}
}
