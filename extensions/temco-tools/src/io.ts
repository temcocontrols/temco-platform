// I/O Studio — the five surfaces behind the container, rebuilt from the mock.
//
// Source: `docs/mock/js/views.industrial.js` (`io/points`, `io/mapping`, `io/logic`, `io/live`, `io/trends`) and the
// mock's side bar, which splits them into **Engineering** and **Live** (`docs/mock/js/data.js`).
//
// The pages are one page each, for the same reason Devices is: the mock's side bar gives each row its own title and
// its own actions, and a section folded inside one page cannot offer either.
//
// **A write is a command, not a local override.** The Point Browser says it, the write card says it, and every action
// here follows it: what changes is the register (`data.ts`, `ioSample.ts`), and the page's foot says the register is
// what this build has instead of a device.

import * as vscode from 'vscode';
import { MAPPINGS, POINTS } from './data';
import {
	LIVE_SUBSCRIBED, PROGRAMS, Program, TREND_NOTE, TREND_SERIES, TREND_TITLE, livePaused, nextSeries, selectProgram,
	selectedProgram, setLivePaused
} from './ioSample';
import { PageMessage, commandScript, esc, icon, page, pageColumn, toneMark } from './ui';

/** One surface of the I/O container: the row, the command, and the page it draws. */
export interface IoPage {
	id: string;
	label: string;
	note: string;
	mark: string;
	command: string;
	viewType: string;
	group: 'engineering' | 'live';
}

export const IO_PAGES: IoPage[] = [
	{ id: 'points', label: 'Point Browser', note: 'every point on the selected controller, with its value', mark: 'list', command: 'temcoTools.io.points', viewType: 'temcoTools.io.points', group: 'engineering' },
	{ id: 'mapping', label: 'Mapping', note: 'how a point becomes a named value', mark: 'link', command: 'temcoTools.io.mapping', viewType: 'temcoTools.io.mapping', group: 'engineering' },
	{ id: 'logic', label: 'Logic', note: 'the programs on the device, as their source', mark: 'code', command: 'temcoTools.io.logic', viewType: 'temcoTools.io.logic', group: 'engineering' },
	{ id: 'live', label: 'Live Values', note: 'a subscription, not a poll', mark: 'activity', command: 'temcoTools.io.live', viewType: 'temcoTools.io.live', group: 'live' },
	{ id: 'trends', label: 'Trends', note: 'the same point over time, two series overlaid', mark: 'chart', command: 'temcoTools.io.trends', viewType: 'temcoTools.io.trends', group: 'live' }
];

/* ------------------------------------------------------------------ page vocabulary */

const button = (label: string, command: string, options: { kind?: 'primary' | 'ghost'; mark?: string; args?: unknown; small?: boolean } = {}): string =>
	`<button type="button" class="btn${options.small ? ' btn--sm' : ''}${options.kind ? ` btn--${options.kind}` : ''}" data-command="${command}"${options.args === undefined ? '' : ` data-args="${esc(JSON.stringify(options.args))}"`}>${options.mark ? icon(options.mark) : ''}<span>${esc(label)}</span></button>`;

const badge = (text: string, tone?: string): string =>
	`<span class="badge${tone && tone !== 'neutral' ? ` badge--${tone}` : ''}">${esc(text)}</span>`;

const pageHead = (options: { title: string; mark: string; desc: string; actions: string }): string =>
	`<div class="page-head"><div class="page-head__main"><h1 class="page-head__title">${icon(options.mark)}${esc(options.title)}</h1><p class="page-head__desc">${esc(options.desc)}</p></div><div class="page-head__actions">${options.actions}</div></div>`;

const rule = (options: { label: string; count?: string; note?: string; actions?: string }): string =>
	`<div class="group-head"><span class="group-head__label">${esc(options.label)}</span><span class="group-head__rule"></span>${options.count ? `<span class="group-head__count">${esc(options.count)}</span>` : ''}${options.actions ? `<span class="group-head__actions">${options.actions}</span>` : ''}</div>${options.note ? `<p class="group-note">${esc(options.note)}</p>` : ''}`;

const group = (options: { label: string; count?: string; note?: string; body: string }): string =>
	`${rule(options)}<div class="record-list">${options.body}</div>`;

const tiles = (items: { value: string; label: string }[]): string =>
	`<div class="tiles">${items.map((item) => `<div class="tile"><span class="tile__value">${esc(item.value)}</span><span class="tile__label">${esc(item.label)}</span></div>`).join('')}</div>`;

const card = (options: { title: string; mark?: string; desc?: string; body: string; foot?: string }): string =>
	`<div class="card card--plain"><div class="card__head">${options.mark ? `<span class="card__icon">${icon(options.mark)}</span>` : ''}<div class="card__title">${esc(options.title)}</div></div>${options.desc ? `<p class="card__desc">${options.desc}</p>` : ''}${options.body}${options.foot ? `<div class="card__foot">${options.foot}</div>` : ''}</div>`;

const callout = (html: string, kind: 'warn' | 'ok' | 'info' = 'info'): string =>
	`<div class="callout${kind === 'info' ? '' : ` callout--${kind}`}">${icon(kind === 'warn' ? 'alert' : kind === 'ok' ? 'check' : 'info')}<div>${html}</div></div>`;

const bar = (percent: number, tone: 'ok' | 'warn'): string =>
	`<span class="bar"><span class="bar__fill bar__fill--${tone}" style="width:${percent}%"></span></span>`;

const n = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/** A run of samples, the mock's own polyline — no charting library, and no scale the data does not support. */
function sparkline(values: number[], tone: string): string {
	const width = 120;
	const height = 30;
	const min = Math.min(...values);
	const max = Math.max(...values);
	const span = max - min || 1;
	const points = values
		.map((value, index) => {
			const x = (index * width) / (values.length - 1);
			const y = height - ((value - min) / span) * (height - 4) - 2;
			return `${x.toFixed(1)},${y.toFixed(1)}`;
		})
		.join(' ');
	const colour = tone === 'subtle' ? 'var(--fg-subtle)' : `var(--${tone})`;
	return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="color:${colour}" aria-hidden="true"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></polyline></svg>`;
}

/** The controller the points, the programs and the trends all belong to. */
const CONTROLLER = 'T3-BB · AHU-1';

/* ------------------------------------------------------------------ the five pages */

/** The suggestion Mapping offers once: the mock's own, and the only one this build holds. */
const SUGGESTION = { source: 'AI3 · Humidity', target: 'AV-104 · RH' };

/** True when the suggestion has been applied or ignored and must not be offered again this session. */
let suggestionAnswered = false;

/** *Point Browser* — the mock's `io/points`. */
function pointsBody(): string {
	const groups = [
		{ label: 'Analog Input', types: ['AI'] },
		{ label: 'Analog Output', types: ['AO'] },
		{ label: 'Digital', types: ['DI', 'DO'] }
	];

	const row = (point: typeof POINTS[number]): string => `<div class="record-row" data-point-row data-point-type="${esc(point.type)}" data-point-search="${esc(`${point.id} ${point.label} ${point.type} ${point.range}`.toLowerCase())}">
	${toneMark(point.type === 'DI' || point.type === 'DO' ? 'activity' : 'chart', point.state === 'warn' ? 'warn' : undefined)}
	<div class="record-row__main">
		<div class="record-row__title"><span class="record-row__name"><span class="cell-mono">${esc(point.id)}</span> · ${esc(point.label)}</span>${point.state === 'warn' ? badge('Fault', 'warn') : ''}</div>
		<div class="record-row__meta"><span class="tag">${esc(point.type)}</span><span>range ${esc(point.range)}</span><span>${esc(point.type === 'DI' || point.type === 'DO' ? 'Digital' : 'Analog')} ${point.type === 'AI' || point.type === 'DI' ? 'Input' : 'Output'}</span></div>
	</div>
	<div class="record-row__state cell-mono cell-strong">${esc(point.value)}</div>
	<div class="record-row__state cell-muted">${esc(point.unit)}</div>
</div>`;

	const section = groups.map((entry) => {
		const points = POINTS.filter((point) => entry.types.includes(point.type));
		if (points.length === 0) {
			return '';
		}
		return `<div data-point-group class="mt-24">${group({ label: entry.label, count: n(points.length, 'point', 'points'), body: points.map(row).join('') })}</div>`;
	}).join('');

	return `${pageHead({
		title: 'Point Browser',
		mark: 'list',
		desc: 'Every point on the selected controller, with its live value. Writing one is a command to the device at a priority — it is not a local override the platform keeps.',
		actions: button('Add Point', 'temcoTools.io.addPoint', { kind: 'primary', mark: 'plus' }) + button('Export CSV', 'temcoTools.io.exportPoints', { mark: 'download' })
	})}
<div class="toolbar">
	<input class="input" type="search" placeholder="Filter points" aria-label="Filter points" data-io-filter>
	<div class="segmented" role="group" aria-label="Point type">
		${['All', 'AI', 'AO', 'DI', 'DO'].map((type) => `<button type="button" data-io-type="${type}" aria-pressed="${type === 'All'}">${type}</button>`).join('')}
	</div>
	<span class="toolbar__spacer"></span>
	<span class="cell-muted" style="font-size:12px">${esc(CONTROLLER)} · ${n(POINTS.length, 'point', 'points')}</span>
</div>
${section}
<div class="mt-24 grid grid--2">
	${card({
		title: 'Write a Value',
		desc: 'AO1 · Valve Position. A write is held at the priority you pick; priority 8 is an operator override, and the schedule takes the point back at its next event.',
		body: `<div class="settings-rows">
			<div class="form-row"><div class="form-row__main"><div class="form-row__label">Value</div><div class="form-row__desc">Percent, 0 – 100.</div></div><div class="form-row__control"><input class="input" value="${esc(POINTS.find((point) => point.id === 'AO1')?.value ?? '38.5')}" aria-label="Value" data-io-value></div></div>
			<div class="form-row"><div class="form-row__main"><div class="form-row__label">Priority</div><div class="form-row__desc">Lower numbers win.</div></div><div class="form-row__control"><select class="select" aria-label="Priority" data-io-priority><option>8 · operator</option><option>10 · local</option><option>16 · default</option></select></div></div>
		</div>`,
		foot: `<button type="button" class="btn btn--sm btn--primary" id="io-write">${icon('check')}<span>Write</span></button><span>writes to the device</span>`
	})}
	${card({
		title: 'Selected Point',
		desc: 'Where the value comes from, and what reads it.',
		body: `<dl class="kv"><dt>Object</dt><dd class="cell-mono">AV-103</dd><dt>Units</dt><dd>percent</dd><dt>Scale</dt><dd class="cell-mono">×1.0 + 0</dd><dt>COV</dt><dd>enabled · 0.5 %</dd><dt>Trend</dt><dd>15 min · 1,882 samples</dd></dl>`
	})}
</div>
<div class="mt-16">${callout('The values above come from this build’s register, not from the controller: there is no device connection yet. A write here changes the register and says so — it does not reach a device.')}</div>`;
}

/** *Mapping* — the mock's `io/mapping`. */
function mappingBody(): string {
	const mapped = MAPPINGS.filter((entry) => entry.state === 'Mapped').length;
	const review = MAPPINGS.filter((entry) => entry.state === 'Needs review').length;
	const unmapped = MAPPINGS.filter((entry) => entry.state === 'Unmapped').length;
	const suggestion = MAPPINGS.find((entry) => entry.source === SUGGESTION.source);
	const offerSuggestion = !suggestionAnswered && suggestion !== undefined && suggestion.state === 'Unmapped';

	return `${pageHead({
		title: 'Mapping',
		mark: 'link',
		desc: 'How a physical point becomes a named value the rest of the platform reads. An unmapped point is invisible to programs and to trends.',
		actions: button('Auto-Map', 'temcoTools.io.autoMap', { kind: 'primary', mark: 'sparkle' })
	})}
<div class="mt-16">${tiles([
		{ value: String(MAPPINGS.length), label: 'Points' },
		{ value: String(mapped), label: 'Mapped' },
		{ value: String(review), label: 'Needs review' },
		{ value: String(unmapped), label: 'Unmapped' }
	])}</div>
<div class="mt-24">${group({
		label: 'Mappings',
		count: n(MAPPINGS.length, 'row', 'rows'),
		note: 'The source is the controller’s own point id; the target is the platform value a program names.',
		body: MAPPINGS.map((entry) => `<div class="record-row">
	${toneMark('link', entry.tone === 'neutral' ? undefined : entry.tone)}
	<div class="record-row__main">
		<div class="record-row__title"><span class="record-row__name cell-mono">${esc(entry.source)}</span>${icon('arrow-right', 'icon--sm')}<span class="cell-mono">${esc(entry.target)}</span></div>
		<div class="record-row__meta"><span>scale ${esc(entry.scale)}</span></div>
	</div>
	<div class="record-row__state">${badge(entry.state, entry.tone)}</div>
	${button('Edit', 'temcoTools.io.editMapping', { small: true, kind: 'ghost', args: [entry.source] })}
</div>`).join('')
	})}</div>
${offerSuggestion ? `<div class="mt-24">${card({
		title: 'AI Suggestion',
		mark: 'sparkle',
		desc: 'Humidity on this controller has no mapping. The last three projects mapped it to <b>AV-104 · RH</b> with the same scaling.',
		body: '',
		foot: button('Apply', 'temcoTools.io.applyMapping', { small: true, kind: 'primary' }) + button('Ignore', 'temcoTools.io.ignoreMapping', { small: true, kind: 'ghost' })
	})}</div>` : ''}
<div class="mt-16">${callout('A mapping is a platform record, not a device write: applying one changes what this window reads, and the controller keeps publishing the same point.')}</div>`;
}

/** *Logic* — the mock's `io/logic`. */
function logicBody(): string {
	const program: Program | undefined = PROGRAMS[selectedProgram];

	return `${pageHead({
		title: 'Logic',
		mark: 'code',
		desc: 'Programs on the device, shown as their source. Compiling writes the program; it does not run until the device restarts, and a program that has not compiled is not running.',
		actions: button('New Program', 'temcoTools.io.newProgram', { kind: 'primary', mark: 'plus' }) + button('Compile', 'temcoTools.io.compile', { mark: 'play' })
	})}
${rule({
		label: program ? program.name : 'No program',
		count: program ? (program.state === 'Needs compile' ? 'changed · not compiled' : `compiled · ${program.state.toLowerCase()}`) : undefined,
		actions: badge(program && program.state !== 'Needs compile' ? 'No errors' : 'Not compiled', program && program.state !== 'Needs compile' ? 'ok' : 'warn')
	})}
<div class="mt-16"><pre class="code" style="max-height:360px">${esc(program ? program.source : '// no program is open')}</pre></div>
<div class="mt-24">${group({
		label: 'Programs',
		count: n(PROGRAMS.length, 'program', 'programs'),
		body: PROGRAMS.map((entry) => `<div class="record-row${entry === program ? ' record-row--current' : ''}">
	${toneMark('code', entry.tone === 'neutral' ? undefined : entry.tone)}
	<div class="record-row__main">
		<div class="record-row__title"><span class="record-row__name">${esc(entry.name)}</span></div>
		<div class="record-row__meta"><span>${esc(entry.note)}</span></div>
	</div>
	<div class="record-row__state">${badge(entry.state, entry.tone)}</div>
	${button('Open', 'temcoTools.io.openProgram', { small: true, kind: 'ghost', args: [entry.name] })}
</div>`).join('')
	})}</div>
<div class="mt-24">${group({
		label: 'Diagnostics',
		count: '1 warning',
		body: `<div class="record-row record-row--static">
	${toneMark('check', 'ok')}
	<div class="record-row__main">
		<div class="record-row__title"><span class="record-row__name">No compile errors</span></div>
		<div class="record-row__meta"><span>last compile 09:12</span></div>
	</div>
	<div class="record-row__state"></div>
	<div class="record-row__state"></div>
</div>
<div class="record-row record-row--static">
	${toneMark('warning', 'warn')}
	<div class="record-row__main">
		<div class="record-row__title"><span class="record-row__name">One branch can never run</span></div>
		<div class="record-row__meta"><span>line 24</span><span>DI1 is never FAULT on this device</span></div>
	</div>
	<div class="record-row__state">${badge('Warning', 'warn')}</div>
	<div class="record-row__state"></div>
</div>`
	})}</div>
<div class="mt-16">${callout('Compiling here marks the program compiled in this build’s register. The write that matters is the one to the controller, and the restart that follows it — neither of which this build can make.')}</div>`;
}

/** *Live Values* — the mock's `io/live`. */
function liveBody(): string {
	const row = (point: typeof POINTS[number]): string => {
		const numeric = Number.parseFloat(point.value);
		const level = Number.isNaN(numeric) ? undefined : point.range.includes('0 – 100') ? numeric : Math.min(100, (numeric / 50) * 100);
		return `<div class="record-row record-row--static">
	${toneMark('activity', point.state === 'warn' ? 'warn' : undefined)}
	<div class="record-row__main">
		<div class="record-row__title"><span class="record-row__name"><span class="cell-mono">${esc(point.id)}</span> · ${esc(point.label)}</span></div>
		<div class="record-row__meta"><span>${esc(point.type === 'DI' || point.type === 'DO' ? 'Digital' : 'Analog')} ${point.type === 'AI' || point.type === 'DI' ? 'Input' : 'Output'}</span><span>${livePaused ? 'paused' : 'updated just now'}</span></div>
	</div>
	<div class="record-row__state">${livePaused || level === undefined ? '<span class="cell-muted">—</span>' : `<div style="min-width:120px">${bar(level, level > 80 ? 'warn' : 'ok')}</div>`}</div>
	<div class="record-row__state cell-mono cell-strong">${livePaused ? '<span class="cell-muted">—</span>' : `${esc(point.value)} <span class="cell-muted">${esc(point.unit)}</span>`}</div>
</div>`;
	};

	return `${pageHead({
		title: 'Live Values',
		mark: 'activity',
		desc: 'A subscription, not a poll: values arrive when the device sends them. Closing the tab ends the subscription, which is why nothing here is kept.',
		actions: livePaused
			? button('Resume', 'temcoTools.io.toggleLive', { mark: 'play' })
			: button('Pause', 'temcoTools.io.toggleLive', { mark: 'close' })
	})}
<div class="mt-24">${group({
		label: 'Subscribed Values',
		count: n(POINTS.length, 'point', 'points'),
		body: POINTS.map(row).join('')
	})}</div>
<div class="mt-24">${group({
		label: 'Subscribed Devices',
		count: n(LIVE_SUBSCRIBED.length, 'device', 'devices'),
		note: 'A subscription ends with the tab, so a controller is not polled by a window nobody is looking at.',
		body: LIVE_SUBSCRIBED.map((entry) => `<div class="record-row record-row--static">
	${toneMark('chip', entry.tone)}
	<div class="record-row__main">
		<div class="record-row__title"><span class="record-row__name">${esc(entry.name)}</span></div>
		<div class="record-row__meta"><span>${n(entry.points, 'point', 'points')}</span><span>change of value</span></div>
	</div>
	<div class="record-row__state">${badge(livePaused ? 'Paused' : entry.state, livePaused ? 'neutral' : entry.tone)}</div>
	<div class="record-row__state"></div>
</div>`).join('')
	})}</div>
<div class="mt-16">${callout('There is no subscription in this build: the values are the register’s, and Pause stops the page claiming they are current.')}</div>`;
}

/** *Trends* — the mock's `io/trends`. */
function trendsBody(): string {
	const series = TREND_SERIES;
	const facts = series.map((entry, index) => (index === 0
		? `<span><span class="dot dot--accent"></span> ${esc(entry.label)}</span>`
		: `<span>${esc(entry.label)}</span>`)).join('');
	const supply = series[0]?.values ?? [];
	const mean = supply.length ? supply.reduce((total, value) => total + value, 0) / supply.length : 0;

	return `${pageHead({
		title: 'Trends',
		mark: 'chart',
		desc: 'The same point over time. Two series are overlaid to compare what a program asked for with what the equipment did.',
		actions: button('Add Series', 'temcoTools.io.addSeries', { mark: 'plus' })
	})}
${card({
		title: TREND_TITLE,
		desc: TREND_NOTE,
		body: `<div style="display:flex;gap:16px;align-items:flex-end;padding:10px 0;overflow:auto">${series.map((entry) => `<div style="color:${entry.tone === 'subtle' ? 'var(--fg-subtle)' : `var(--${entry.tone})`}">${sparkline(entry.values, entry.tone)}</div>`).join('')}</div>
	<div class="facts">${facts}<span>mean ${mean.toFixed(1)} · min ${Math.min(...supply).toFixed(1)} · max ${Math.max(...supply).toFixed(1)}</span></div>`
	})}
<div class="mt-16">${callout(`${n(series.length, 'series is', 'series are')} all this build holds for this controller; Add Series overlays the next point that already has a trend rather than inventing one.`)}</div>`;
}

const BODIES: { [id: string]: { body: () => string; script: () => string } } = {
	points: { body: pointsBody, script: () => commandScript + POINTS_SCRIPT },
	mapping: { body: mappingBody, script: () => commandScript },
	logic: { body: logicBody, script: () => commandScript },
	live: { body: liveBody, script: () => commandScript },
	trends: { body: trendsBody, script: () => commandScript }
};

/**
 * The Point Browser's own behaviour: the filter, the type chips, and the Write button.
 *
 * Filtering and the segmented control are pure page state — nothing outside the page has any use for "which rows are
 * showing" — so they run here. The write is the one thing that leaves: it asks the module, because a value that
 * reached a device is not a page's decision.
 */
const POINTS_SCRIPT = `
(function () {
	const api = acquireVsCodeApi();
	const search = document.querySelector('[data-io-filter]');
	const chips = Array.prototype.slice.call(document.querySelectorAll('[data-io-type]'));
	const groups = Array.prototype.slice.call(document.querySelectorAll('[data-point-group]'));
	let type = 'All';

	function apply() {
		const term = (search.value || '').toLowerCase();
		groups.forEach(function (group) {
			let shown = 0;
			Array.prototype.forEach.call(group.querySelectorAll('[data-point-row]'), function (row) {
				const matchesType = type === 'All' || row.dataset.pointType === type;
				const matchesTerm = term.length === 0 || row.dataset.pointSearch.indexOf(term) >= 0;
				row.hidden = !(matchesType && matchesTerm);
				if (!row.hidden) { shown++; }
			});
			group.hidden = shown === 0;
		});
	}

	if (search) { search.addEventListener('input', apply); }
	chips.forEach(function (chip) {
		chip.addEventListener('click', function () {
			type = chip.dataset.ioType;
			chips.forEach(function (other) { other.setAttribute('aria-pressed', String(other === chip)); });
			apply();
		});
	});

	const write = document.getElementById('io-write');
	if (write) {
		write.addEventListener('click', function () {
			const value = document.querySelector('[data-io-value]').value;
			const priority = document.querySelector('[data-io-priority]').value;
			api.postMessage({ type: 'command', command: 'temcoTools.io.writePoint', args: [value, priority] });
		});
	}
})();
`;

/** The five pages, one panel each, kept open so a second visit reveals the tab rather than stacking another. */
export class IoPages {
	private readonly panels = new Map<string, vscode.WebviewPanel>();

	constructor(private readonly context: vscode.ExtensionContext) { }

	open(id: string, restored?: vscode.WebviewPanel): void {
		const definition = IO_PAGES.find((entry) => entry.id === id);
		const pageBody = BODIES[id];
		if (!definition || !pageBody) {
			return;
		}
		const existing = this.panels.get(id);
		if (existing) {
			existing.reveal(pageColumn());
			existing.webview.html = this.document(definition, pageBody);
			return;
		}
		// A restored tab is drawn into rather than replaced: it keeps its place in the strip.
		const panel = restored ?? vscode.window.createWebviewPanel(definition.viewType, definition.label, pageColumn(), {
			enableScripts: true,
			localResourceRoots: []
		});
		panel.webview.options = { enableScripts: true, localResourceRoots: [] };
		panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'io.svg');
		panel.webview.html = this.document(definition, pageBody);
		panel.webview.onDidReceiveMessage((message: PageMessage) => {
			if (message.type !== 'command' || typeof message.command !== 'string') {
				return;
			}
			// The page sends `data-args` as one array; a command wants them spread — the write takes a value *and*
			// a priority, and the priority is the half that decides who wins.
			const args = Array.isArray(message.args) ? message.args : message.args === undefined ? [] : [message.args];
			void vscode.commands.executeCommand(message.command, ...args);
		});
		this.panels.set(id, panel);
		panel.onDidDispose(() => this.panels.delete(id));
	}

	/** Re-draws every page that is open — a write on one is a fact on the others. */
	refresh(): void {
		for (const [id, panel] of this.panels) {
			const definition = IO_PAGES.find((entry) => entry.id === id);
			const pageBody = BODIES[id];
			if (definition && pageBody) {
				panel.webview.html = this.document(definition, pageBody);
			}
		}
	}

	dispose(): void {
		for (const panel of this.panels.values()) {
			panel.dispose();
		}
		this.panels.clear();
	}

	private document(definition: IoPage, pageBody: { body: () => string; script: () => string }): string {
		return page(pageBody.body(), { title: definition.label, script: pageBody.script() });
	}
}

/* ------------------------------------------------------------------ what a button does */

/** The CSV the Export button copies: the same columns the page shows, one row per point. */
function pointsCsv(): string {
	const header = 'id,label,type,value,unit,range';
	const rows = POINTS.map((point) => [point.id, point.label, point.type, point.value, point.unit, point.range]
		.map((value) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value))
		.join(','));
	return [header, ...rows].join('\n');
}

export function registerIo(context: vscode.ExtensionContext): { pages: IoPages; disposables: vscode.Disposable[] } {
	const pages = new IoPages(context);
	const changed = (): void => pages.refresh();

	const commands: vscode.Disposable[] = [
		...IO_PAGES.map((definition) => vscode.commands.registerCommand(definition.command, () => pages.open(definition.id))),

		// ---- Point Browser
		vscode.commands.registerCommand('temcoTools.io.addPoint', async () => {
			const named = await vscode.window.showInputBox({
				title: 'Add a Point',
				prompt: 'An id and a label, separated by a middle dot — the id is the controller’s own',
				placeHolder: 'AI4 · Outdoor Air Temp',
				value: ''
			});
			if (named === undefined || named.trim().length === 0) {
				return;
			}
			const [id, ...rest] = named.split('·').map((part) => part.trim());
			const label = rest.join(' · ') || id;
			if (POINTS.some((point) => point.id.toLowerCase() === id.toLowerCase())) {
				await vscode.window.showWarningMessage(`Temco I/O: ${id} is already on this controller.`);
				return;
			}
			const type = id.replace(/[0-9]/g, '').toUpperCase() || 'AI';
			POINTS.push({ id, label, type, unit: '—', value: '—', range: '—', state: 'ok' });
			changed();
			await vscode.window.showInformationMessage(
				`Temco I/O: ${id} · ${label} added to the register as a ${type} point. The controller has not been told, so it will not publish it.`
			);
		}),

		vscode.commands.registerCommand('temcoTools.io.exportPoints', async () => {
			await vscode.env.clipboard.writeText(pointsCsv());
			await vscode.window.showInformationMessage(
				`Temco I/O: ${n(POINTS.length, 'point', 'points')} copied as CSV, with the values this page is showing.`
			);
		}),

		vscode.commands.registerCommand('temcoTools.io.writePoint', async (value?: unknown, priority?: unknown) => {
			const point = POINTS.find((entry) => entry.id === 'AO1');
			if (!point) {
				return;
			}
			const written = String(value ?? '').trim();
			const numeric = Number.parseFloat(written);
			if (written.length === 0 || Number.isNaN(numeric) || numeric < 0 || numeric > 100) {
				await vscode.window.showWarningMessage('Temco I/O: a valve position is a number from 0 to 100.');
				return;
			}
			point.value = written.includes('.') ? numeric.toFixed(1) : String(numeric);
			changed();
			const at = String(priority ?? '8').split(' ')[0];
			await vscode.window.showInformationMessage(
				`Temco I/O: AO1 written ${point.value} % at priority ${at}. The register changed; the controller has not been written to, and the schedule takes the point back at its next event.`
			);
		}),

		// ---- Mapping
		vscode.commands.registerCommand('temcoTools.io.autoMap', async () => {
			const entry = MAPPINGS.find((mapping) => mapping.source === SUGGESTION.source);
			if (!entry || entry.state !== 'Unmapped') {
				await vscode.window.showInformationMessage('Temco I/O: nothing is left for the mapping suggestion to match.');
				return;
			}
			entry.target = SUGGESTION.target;
			entry.scale = '×1.0 + 0';
			entry.state = 'Mapped';
			entry.tone = 'ok';
			suggestionAnswered = true;
			changed();
			await vscode.window.showInformationMessage(
				`Temco I/O: ${entry.source} mapped to ${entry.target}. That is the only suggestion this build holds, so nothing else was guessed.`
			);
		}),

		vscode.commands.registerCommand('temcoTools.io.applyMapping', async () => {
			const entry = MAPPINGS.find((mapping) => mapping.source === SUGGESTION.source);
			if (!entry) {
				return;
			}
			entry.target = SUGGESTION.target;
			entry.scale = '×1.0 + 0';
			entry.state = 'Mapped';
			entry.tone = 'ok';
			suggestionAnswered = true;
			changed();
			await vscode.window.showInformationMessage(`Temco I/O: ${entry.source} → ${entry.target}, with the scale the suggestion carried.`);
		}),

		vscode.commands.registerCommand('temcoTools.io.ignoreMapping', async () => {
			suggestionAnswered = true;
			changed();
			await vscode.window.showInformationMessage('Temco I/O: the suggestion is set aside for this session. The point stays unmapped.');
		}),

		vscode.commands.registerCommand('temcoTools.io.editMapping', async (source?: unknown) => {
			const entry = MAPPINGS.find((mapping) => mapping.source === String(source));
			if (!entry) {
				return;
			}
			const target = await vscode.window.showInputBox({
				title: `Map ${entry.source}`,
				prompt: 'The platform value a program names. Leave it empty to unmap the point.',
				value: entry.target === '—' ? '' : entry.target,
				placeHolder: 'AV-104 · RH'
			});
			if (target === undefined) {
				return;
			}
			const value = target.trim();
			entry.target = value.length === 0 ? '—' : value;
			entry.state = value.length === 0 ? 'Unmapped' : 'Mapped';
			entry.tone = value.length === 0 ? 'neutral' : 'ok';
			entry.scale = value.length === 0 ? '—' : entry.scale === '—' ? '×1.0 + 0' : entry.scale;
			changed();
			await vscode.window.showInformationMessage(
				value.length === 0
					? `Temco I/O: ${entry.source} is unmapped, so programs and trends cannot see it.`
					: `Temco I/O: ${entry.source} → ${entry.target}.`
			);
		}),

		// ---- Logic
		vscode.commands.registerCommand('temcoTools.io.newProgram', async () => {
			const name = await vscode.window.showInputBox({
				title: 'New Program',
				prompt: 'A name for the program object on the controller',
				placeHolder: 'Night purge'
			});
			if (name === undefined || name.trim().length === 0) {
				return;
			}
			PROGRAMS.push({
				name: name.trim(),
				state: 'Needs compile',
				tone: 'warn',
				note: 'created just now · never compiled',
				source: `// ${name.trim()}\n// not compiled\n\n// the body is written in the editor, and compiled to the controller`
			});
			selectProgram(name.trim());
			changed();
			await vscode.window.showInformationMessage(
				`Temco I/O: “${name.trim()}” created and opened. A program that has not compiled is not running.`
			);
		}),

		vscode.commands.registerCommand('temcoTools.io.compile', async () => {
			const program = PROGRAMS[selectedProgram];
			if (!program) {
				return;
			}
			if (program.state !== 'Needs compile') {
				await vscode.window.showInformationMessage(`Temco I/O: ${program.name} is already compiled and ${program.state.toLowerCase()}.`);
				return;
			}
			program.state = 'Idle';
			program.tone = 'neutral';
			program.note = `compiled ${new Date().toTimeString().slice(0, 5)} · nothing restarted`;
			changed();
			await vscode.window.showInformationMessage(
				`Temco I/O: ${program.name} compiled in the register. It runs when the controller next restarts, which this build cannot ask it to do.`
			);
		}),

		vscode.commands.registerCommand('temcoTools.io.openProgram', async (name?: unknown) => {
			if (selectProgram(String(name))) {
				changed();
			}
		}),

		// ---- Live Values
		vscode.commands.registerCommand('temcoTools.io.toggleLive', async () => {
			setLivePaused(!livePaused);
			changed();
			await vscode.window.showInformationMessage(
				livePaused ? 'Temco I/O: paused. The values below are the register’s, and no longer claim to be current.' : 'Temco I/O: resumed. Nothing was paused on a device — there is no subscription to resume.'
			);
		}),

		// ---- Trends
		vscode.commands.registerCommand('temcoTools.io.addSeries', async () => {
			const candidate = nextSeries();
			if (!candidate) {
				await vscode.window.showInformationMessage('Temco I/O: every point with a trend is already overlaid.');
				return;
			}
			TREND_SERIES.push(candidate);
			changed();
			await vscode.window.showInformationMessage(
				`Temco I/O: ${candidate.label} overlaid. The chart is the page's, so the series lasts as long as the tab.`
			);
		})
	];

	return { pages, disposables: commands };
}
