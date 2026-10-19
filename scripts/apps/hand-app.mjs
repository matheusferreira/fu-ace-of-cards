import { MODULE_ID, TEMPLATES, FUID } from '../constants.mjs';
import * as Deck from '../deck/deck-manager.mjs';
import { maxCards, MIN_CARDS, mpCost, computeEffect } from '../rules/sets.mjs';
import { optionsFor, effectLabel, resolveMagicCards, validate, resolveSwap, swapError } from '../rules/resolution.mjs';
import { swapLimit } from '../rules/sets.mjs';
import { requestGM } from '../socket.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const STATUSES = ['dazed', 'shaken', 'slow', 'weak'];
const OPEN = new Map(); // actorId -> app

/** The Ace of Cards hand window of one actor (owner and GM). */
export class HandApp extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: 'fuaoc-hand-{id}',
		classes: ['fuaoc', 'fuaoc-hand'],
		tag: 'section',
		window: { title: 'FUAOC.Hand.title', icon: 'fa-solid fa-diamond', resizable: true },
		position: { width: 720, height: 'auto' },
		actions: {
			toggleCard: HandApp.#onToggleCard,
			chooseOption: HandApp.#onChooseOption,
			resolve: HandApp.#onResolve,
			clear: HandApp.#onClear,
			createDeck: HandApp.#onCreateDeck,
			setup: HandApp.#onSetup,
			mulligan: HandApp.#onMulligan,
			trapCard: HandApp.#onTrapCard,
		},
	};

	static PARTS = { body: { template: `${TEMPLATES}/hand.hbs` } };

	/** @param {Actor} actor */
	static open(actor) {
		if (!actor) return null;
		let app = OPEN.get(actor.id);
		if (!app) {
			app = new HandApp({ actor, id: `fuaoc-hand-${actor.id}` });
			OPEN.set(actor.id, app);
		}
		app.render({ force: true });
		return app;
	}

	static refreshFor(actorUuid) {
		for (const app of OPEN.values()) if (!actorUuid || app.actor.uuid === actorUuid) app.render();
	}

	constructor(options) {
		super(options);
		this.actor = options.actor;
		this.selected = [];
		this.optionKey = null;
		this.choiceType = null;
		this.statuses = [];
		this.trapAction = 'attack';
	}

	get title() {
		return `${game.i18n.localize('FUAOC.Hand.title')} — ${this.actor.name}`;
	}

	_onClose(options) {
		OPEN.delete(this.actor.id);
		super._onClose(options);
	}

	async _prepareContext() {
		const actor = this.actor;
		const stacks = Deck.getStacks(actor);
		const sl = Deck.skillLevel(actor, FUID.magicCards);
		const ctx = { actor, hasStacks: !!stacks, isGM: game.user.isGM, sl, max: maxCards(sl), min: MIN_CARDS };
		if (!stacks) return ctx;
		const hand = Deck.handCards(actor);
		this.selected = this.selected.filter((id) => hand.some((c) => c.id === id));
		const options = this.selected.length >= MIN_CARDS ? optionsFor(actor, this.selected) : [];
		if (!options.some((o) => `${o.effect}:${o.variant}` === this.optionKey)) this.optionKey = options[0] ? `${options[0].effect}:${options[0].variant}` : null;
		const chosen = options.find((o) => `${o.effect}:${o.variant}` === this.optionKey) ?? null;
		const fx = chosen ? computeEffect(chosen, { level: Deck.actorLevel(actor), blackWhite: Deck.hasHeroic(actor, FUID.blackWhite) }) : null;
		const typeChoices = fx?.typeChoices ?? [];
		if (typeChoices.length && !typeChoices.includes(this.choiceType)) this.choiceType = typeChoices[0];
		const discard = Deck.discardCards(actor);
		return {
			...ctx,
			mp: actor.system?.resources?.mp?.value ?? 0,
			deckCount: stacks.deck.availableCards.length,
			discardCount: discard.length,
			discardTop: discard.at(-1)?.img ?? null,
			cards: hand.map((c) => {
				const r = Deck.toRuleCard(c);
				const order = this.selected.indexOf(c.id);
				return { id: c.id, img: c.img, name: c.name, joker: r.joker, damage: r.suit, selected: order >= 0, order: order + 1 };
			}),
			selectedCount: this.selected.length,
			cost: mpCost(this.selected.length),
			error: this.selected.length ? validate(actor, this.selected) : null,
			options: options.map((o) => ({
				key: `${o.effect}:${o.variant}`,
				label: effectLabel(o),
				text: game.i18n.localize(`FUAOC.Effect.${o.effect}.text`),
				jokers: o.jokers.map((j) => `${j.value} ${game.i18n.localize(`FU.Damage${j.suit.capitalize()}`)}`).join(', '),
				checked: `${o.effect}:${o.variant}` === this.optionKey,
			})),
			typeChoices: typeChoices.map((t) => ({ value: t, label: game.i18n.localize(`FU.Damage${t.capitalize()}`), selected: t === this.choiceType })),
			showStatuses: chosen?.effect === 'fullStatus',
			statuses: STATUSES.map((s) => ({ value: s, label: game.i18n.localize(`FU.${s.capitalize()}`), checked: this.statuses.includes(s) })),
			canResolve: this.selected.length >= MIN_CARDS && !validate(actor, this.selected),
			showNoSet: this.selected.length >= MIN_CARDS && !options.length,
			swap: this.#swapContext(),
		};
	}

	#swapContext() {
		const actor = this.actor;
		const mulliganSL = Deck.skillLevel(actor, FUID.mulligan);
		const trapSL = Deck.skillLevel(actor, FUID.trapCard);
		if (!mulliganSL && !trapSL) return null;
		const n = this.selected.length;
		return {
			mulligan: mulliganSL ? { max: swapLimit(mulliganSL), error: n ? swapError(actor, 'mulligan', this.selected) : null } : null,
			trap: trapSL
				? {
						max: swapLimit(trapSL),
						used: !!actor.getFlag(MODULE_ID, 'trapUsed'),
						error: n ? swapError(actor, 'trapCard', this.selected, { action: this.trapAction }) : null,
						actions: ['attack', 'objective', 'skill', 'spell'].map((a) => ({ value: a, label: game.i18n.localize(`FUAOC.Action.${a}`), selected: a === this.trapAction })),
					}
				: null,
			disabled: !n,
		};
	}

	_onRender(context, options) {
		super._onRender(context, options);
		this.element.querySelectorAll('select[name=trapAction]').forEach((el) =>
			el.addEventListener('change', (ev) => {
				this.trapAction = ev.target.value;
				this.render();
			}),
		);
		this.element.querySelectorAll('select[name=type]').forEach((el) =>
			el.addEventListener('change', (ev) => {
				this.choiceType = ev.target.value;
			}),
		);
		this.element.querySelectorAll('input[name=status]').forEach((el) =>
			el.addEventListener('change', () => {
				this.statuses = [...this.element.querySelectorAll('input[name=status]:checked')].map((i) => i.value).slice(0, 2);
				this.render();
			}),
		);
	}

	static #onToggleCard(event, target) {
		const id = target.dataset.cardId;
		const i = this.selected.indexOf(id);
		if (i >= 0) this.selected.splice(i, 1);
		else if (this.selected.length < 5) this.selected.push(id);
		this.render();
	}

	static #onChooseOption(event, target) {
		this.optionKey = target.dataset.key;
		this.render();
	}

	static #onClear() {
		this.selected = [];
		this.render();
	}

	static async #onResolve() {
		const options = optionsFor(this.actor, this.selected);
		const chosen = options.find((o) => `${o.effect}:${o.variant}` === this.optionKey) ?? null;
		if (chosen?.effect === 'fullStatus' && this.statuses.length !== 2) {
			ui.notifications.warn(game.i18n.localize('FUAOC.Error.chooseStatuses'));
			return;
		}
		if (!chosen) {
			const ok = await foundry.applications.api.DialogV2.confirm({
				window: { title: game.i18n.localize('FUAOC.Hand.noSetTitle') },
				content: `<p>${game.i18n.localize('FUAOC.Hand.noSetConfirm')}</p>`,
			});
			if (!ok) return;
		}
		const ids = [...this.selected];
		this.selected = [];
		await resolveMagicCards(this.actor, ids, chosen, { type: this.choiceType, statuses: this.statuses });
		this.statuses = [];
		this.render();
	}

	static async #onMulligan() {
		const ids = [...this.selected];
		this.selected = [];
		await resolveSwap(this.actor, 'mulligan', ids);
		this.render();
	}

	static async #onTrapCard() {
		const ids = [...this.selected];
		this.selected = [];
		await resolveSwap(this.actor, 'trapCard', ids, { action: this.trapAction });
		this.render();
	}

	static async #onCreateDeck() {
		await requestGM('ensureStacks', { actorUuid: this.actor.uuid });
		this.render();
	}

	static async #onSetup() {
		await requestGM('setupConflict', { actorUuid: this.actor.uuid });
		this.render();
	}
}

export function handActorForUser(user = game.user) {
	if (user.character && Deck.isAce(user.character)) return user.character;
	return Deck.aceActors().find((a) => a.testUserPermission(user, 'OWNER') && !user.isGM) ?? null;
}

export { MODULE_ID };
