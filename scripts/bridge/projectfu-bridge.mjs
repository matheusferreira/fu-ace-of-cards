/**
 * The only file that touches projectfu internals. Tested against projectfu 4.16.2.
 * Every call falls back to plain document updates if the system modules cannot be loaded.
 */
const BASE = '/systems/projectfu/module';
let mods = null;

async function load() {
	if (mods) return mods;
	try {
		const [dmg, res, dd, inline, fx] = await Promise.all([
			import(`${BASE}/pipelines/damage-pipeline.mjs`),
			import(`${BASE}/pipelines/resource-pipeline.mjs`),
			import(`${BASE}/checks/damage-data.mjs`),
			import(`${BASE}/helpers/inline-helper.mjs`),
			import(`${BASE}/pipelines/effects.mjs`),
		]);
		mods = { dmg, res, dd, inline, fx, ok: true };
	} catch (e) {
		console.warn('fu-ace-of-cards | projectfu internals unavailable, using fallback updates', e);
		mods = { ok: false };
	}
	return mods;
}

function sourceInfo(m, actor, name) {
	return m.inline.InlineSourceInfo.fromInstance(actor, null, name);
}

/** Snapshot of HP/MP/statuses to allow Revert. */
export function snapshot(actors) {
	return actors.map((a) => ({
		uuid: a.uuid,
		hp: a.system?.resources?.hp?.value,
		mp: a.system?.resources?.mp?.value,
		statuses: [...(a.statuses ?? [])],
	}));
}

export async function restore(snapshots) {
	for (const s of snapshots) {
		const a = await fromUuid(s.uuid);
		if (!a) continue;
		await a.update({ 'system.resources.hp.value': s.hp, 'system.resources.mp.value': s.mp });
		const now = new Set(a.statuses ?? []);
		for (const st of ['dazed', 'shaken', 'slow', 'weak']) {
			const had = s.statuses.includes(st);
			if (had !== now.has(st)) await a.toggleStatusEffect(st, { active: had });
		}
	}
}

/**
 * Deal damage of a type to targets through the projectfu damage pipeline (affinities, traits, chat output).
 * @param {Actor} source
 * @param {Actor[]} targets
 */
export async function dealDamage(source, targets, amount, type, { name, ignoreResistances = false, ignoreImmunities = false } = {}) {
	const m = await load();
	if (m.ok) {
		const data = m.dd.DamageData.construct(type, amount);
		const req = new m.dmg.DamageRequest(sourceInfo(m, source, name), targets, data);
		if (ignoreResistances) req.addTraits('ignore-resistances');
		if (ignoreImmunities) req.addTraits('ignore-immunities');
		return m.dmg.DamagePipeline.process(req);
	}
	for (const t of targets) {
		const hp = t.system.resources.hp.value;
		await t.update({ 'system.resources.hp.value': Math.max(0, hp - amount) });
	}
}

/** Recover HP or MP (resource 'hp' | 'mp'). */
export async function recover(source, targets, resource, amount, { name } = {}) {
	if (!amount) return;
	const m = await load();
	if (m.ok) {
		const req = new m.res.ResourceRequest(sourceInfo(m, source, name), targets, resource, amount);
		return m.res.ResourcePipeline.process(req);
	}
	for (const t of targets) {
		const r = t.system.resources[resource];
		await t.update({ [`system.resources.${resource}.value`]: Math.min(r.max, r.value + amount) });
	}
}

/** Spend MP (cost of Magic Cards). */
export async function spendMP(actor, amount, { name } = {}) {
	if (!amount) return;
	const m = await load();
	if (m.ok) {
		const req = new m.res.ResourceRequest(sourceInfo(m, actor, name), [actor], 'mp', -amount);
		return m.res.ResourcePipeline.process(req);
	}
	const mp = actor.system.resources.mp.value;
	await actor.update({ 'system.resources.mp.value': Math.max(0, mp - amount) });
}

/** Apply or remove status effects (dazed, shaken, slow, weak). */
export async function setStatuses(targets, statuses, active) {
	for (const t of targets) {
		for (const st of statuses) {
			const has = t.statuses?.has(st);
			if (active && !has) await t.toggleStatusEffect(st, { active: true });
			if (!active && has) await t.toggleStatusEffect(st, { active: false });
		}
	}
}

/** Temporary effect (High or Low): bonuses until the start of the actor's next turn. */
export async function addTemporaryEffect(actor, { name, img, extraDamage = 0, damageReduction = 0, moduleId }) {
	const changes = [];
	const ADD = CONST.ACTIVE_EFFECT_MODES.ADD;
	if (extraDamage) changes.push({ key: 'system.bonuses.damage.all', mode: ADD, value: String(extraDamage) });
	if (damageReduction) changes.push({ key: 'system.bonuses.incomingDamage.all', mode: ADD, value: String(-damageReduction) });
	if (!changes.length) return null;
	const [effect] = await actor.createEmbeddedDocuments('ActiveEffect', [
		{ name, img: img ?? 'icons/svg/card-joker.svg', changes, flags: { [moduleId]: { untilTurnStart: true } } },
	]);
	return effect;
}

export async function clearTemporaryEffects(actor, moduleId) {
	const ids = actor.effects.filter((e) => e.getFlag(moduleId, 'untilTurnStart')).map((e) => e.id);
	if (ids.length) await actor.deleteEmbeddedDocuments('ActiveEffect', ids);
}
