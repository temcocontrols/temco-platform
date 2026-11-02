// Devices — the six surfaces behind the container, rebuilt from the mock.
//
// Source: `docs/mock/js/views.industrial.js` (`devices/all`, `devices/firmware`, `devices/health`,
// `devices/schedules`, `devices/trends`, `devices/backups`) and the mock's own side bar, which splits them into
// **Fleet** and **Data** (`docs/mock/js/data.js`).
//
// The pages are one page each rather than six sections of one page: the mock's side bar gives each row its own
// title, its own counts and its own actions, and a row that unfolds a section inside a page cannot say "34
// controllers" in the side bar the way the mock does.
//
// **What a button does.** There is no socket to a controller in this build, so every action works on the register
// (`data.ts`, `devicesSample.ts`) and every page says so. What that buys is that the *shape* of each act is
// settled — what it asks, what it refuses, what it says afterwards — so the day a device connection lands, only the
// bottom of each function changes.

import * as vscode from 'vscode';
import { ALARMS, DEVICES, FIRMWARE } from './data';
import {
	BackupRow, DEVICE_BACKUPS, SCHEDULE_ENTRIES, SCHEDULE_ROWS, TREND_CARDS, TREND_LOGS, TrendCard, now
} from './devicesSample';
import { PageMessage, commandScript, esc, icon, page, pageColumn, toneMark } from './ui';

/** One surface of the Devices container: the row, the command, and the page it draws. */
export interface DevicePage {
	id: string;
	label: string;
	note: string;
	mark: string;
	command: string;
	viewType: string;
	/** The group its side-bar row sits in — the mock's Fleet and Data. */
	group: 'fleet' | 'data';
}

export const DEVICE_PAGES: DevicePage[] = [
	{ id: 'all', label: 'Devices', note: 'every controller this workspace can reach', mark: 'circuit-board', command: 'temcoTools.devices.all', viewType: 'temcoTools.devices.all', group: 'fleet' },
	{ id: 'firmware', label: 'Firmware', note: 'the releases, and which controllers run them', mark: 'package', command: 'temcoTools.devices.firmware', viewType: 'temcoTools.devices.firmware', group: 'fleet' },
	{ id: 'health', label: 'Health & Alarms', note: 'what the fleet reports right now', mark: 'warning', command: 'temcoTools.devices.health', viewType: 'temcoTools.devices.health', group: 'fleet' },
	{ id: 'schedules', label: 'Schedules', note: 'the programs the controllers hold', mark: 'clock', command: 'temcoTools.devices.schedules', viewType: 'temcoTools.devices.schedules', group: 'data' },
	{ id: 'trends', label: 'Trend Logs', note: 'samples kept on the devices', mark: 'graph', command: 'temcoTools.devices.trends', viewType: 'temcoTools.devices.trends', group: 'data' },
	{ id: 'backups', label: 'Backups', note: 'a controller’s own database, copied out', mark: 'download', command: 'temcoTools.devices.backups', viewType: 'temcoTools.devices.backups', group: 'data' }
];

/* ------------------------------------------------------------------ page vocabulary */

const button = (label: string, command: string, options: { kind?: 'primary' | 'ghost'; mark?: string; args?: unknown; small?: boolean } = {}): string =>
	`<button type="button" class="btn${options.small ? ' btn--sm' : ''}${options.kind ? ` btn--${options.kind}` : ''}" data-command="${command}"${options.args === undefined ? '' : ` data-args="${esc(JSON.stringify(options.args))}"`}>${options.mark ? icon(options.mark) : ''}<span>${esc(label)}</span></button>`;

const badge = (text: string, tone?: string): string =>
	`<span class="badge${tone && tone !== 'neutral' ? ` badge--${tone}` : ''}">${esc(text)}</span>`;

const pageHead = (options: { title: string; mark: string; desc: string; actions: string }): string =>
	`<div class="page-head"><div class="page-head__main"><h1 class="page-head__title">${icon(options.mark)}${esc(options.title)}</h1><p class="page-head__desc">${esc(options.desc)}</p></div><div class="page-head__actions">${options.actions}</div></div>`;

const hero = (options: { tone: 'warn' | 'ok' | 'accent'; eyebrow: string; title: string; desc: string; actions: string }): string =>
	`<div class="hero-panel${options.tone === 'accent' ? '' : ` hero-panel--${options.tone}`}"><div class="eyebrow">${esc(options.eyebrow)}</div><div class="hero-panel__title">${esc(options.title)}</div><p class="hero-panel__desc">${esc(options.desc)}</p><div class="hero-panel__actions">${options.actions}</div></div>`;

const rule = (options: { label: string; count?: string; note?: string; actions?: string }): string =>
	`<div class="group-head"><span class="group-head__label">${esc(options.label)}</span><span class="group-head__rule"></span>${options.count ? `<span class="group-head__count">${esc(options.count)}</span>` : ''}${options.actions ? `<span class="group-head__actions">${options.actions}</span>` : ''}</div>${options.note ? `<p class="group-note">${esc(options.note)}</p>` : ''}`;

const group = (options: { label: string; count?: string; note?: string; body: string }): string =>
	`${rule(options)}<div class="record-list">${options.body}</div>`;

const tiles = (items: { value: string; label: string }[]): string =>
	`<div class="tiles">${items.map((item) => `<div class="tile"><span class="tile__value">${esc(item.value)}</span><span class="tile__label">${esc(item.label)}</span></div>`).join('')}</div>`;

const callout = (html: string, kind: 'warn' | 'ok' | 'info' = 'info'): string =>
	`<div class="callout${kind === 'info' ? '' : ` callout--${kind}`}">${icon(kind === 'warn' ? 'alert' : kind === 'ok' ? 'check' : 'info')}<div>${html}</div></div>`;

const bar = (percent: number, tone: 'ok' | 'warn'): string =>
	`<span class="bar"><span class="bar__fill bar__fill--${tone}" style="width:${percent}%"></span></span>`;

/** The count with its noun, as the mock writes it: "1 controller", "34 controllers". */
const n = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/** Twelve samples of one point, drawn without a charting library: the mock's own polyline. */
function sparkline(values: number[], tone: TrendCard['tone']): string {
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
	return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="color:var(--${tone})" aria-hidden="true"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></polyline></svg>`;
}

/* ------------------------------------------------------------------ the six pages */

/** *Devices* — the mock's `devices/all`. */
function allBody(): string {
	const offline = DEVICES.filter((device) => device.status === 'Offline');
	const degraded = DEVICES.filter((device) => device.status === 'Warning');
	const answering = DEVICES.filter((device) => device.status === 'Online');
	const current = FIRMWARE.find((release) => release.state === 'Current') ?? FIRMWARE.find((release) => release.state === 'Staged');
	const onCurrent = current ? DEVICES.filter((device) => device.firmware === current.version).length : 0;
	const active = ALARMS.filter((alarm) => alarm.state === 'Active').length;
	const worst = offline[0] ?? degraded[0];

	const deviceRow = (device: typeof DEVICES[number]): string => {
		const alarms = ALARMS.filter((alarm) => alarm.device === device.name && alarm.state !== 'Cleared').length;
		return `<div class="record-row">
	${toneMark('chip', device.status === 'Offline' ? 'err' : device.status === 'Warning' ? 'warn' : 'ok')}
	<div class="record-row__main">
		<div class="record-row__title"><span class="record-row__name">${esc(device.name)}</span><span class="tag">${esc(device.product)}</span></div>
		<div class="record-row__meta">
			<span class="cell-mono">SN ${device.serial}</span>
			<span class="cell-mono">${esc(device.ip)}</span>
			<span>firmware ${esc(device.firmware)}</span>
			<span>${n(device.points, 'point', 'points')}</span>
			<span>${esc(device.last)}</span>
		</div>
	</div>
	<div class="record-row__state">${alarms ? badge(n(alarms, 'alarm', 'alarms'), 'warn') : ''}</div>
	<div class="record-row__state">${badge(device.status, device.status === 'Offline' ? 'err' : device.status === 'Warning' ? 'warn' : 'ok')}</div>
</div>`;
	};

	return `${pageHead({
		title: 'Devices',
		mark: 'chip',
		desc: 'Every controller this workspace can reach, with the firmware it runs and the points it exposes. The device keeps its own database; the platform keeps a copy only when a backup or a trend log is read.',
		actions: button('Discover', 'temcoTools.devices.discover', { kind: 'primary', mark: 'search' }) + button('Add by Address', 'temcoTools.devices.add', { mark: 'plus' })
	})}
${worst ? hero({
		tone: 'warn',
		eyebrow: 'Fleet',
		title: `${worst.name} has not answered for ${worst.last.replace(' ago', '')}`,
		desc: `Last known firmware ${worst.firmware}, ${n(ALARMS.filter((alarm) => alarm.device === worst.name && alarm.state !== 'Cleared').length, 'active condition', 'active conditions')}. The other ${n(answering.length, 'controller answers', 'controllers answer')} normally.`,
		actions: button(`Diagnose ${worst.product}`, 'temcoTools.devices.diagnose', { kind: 'primary', mark: 'activity', args: [worst.serial] }) + button('Open Network Tools', 'temcoTools.network.diagnostics', { mark: 'globe' })
	}) : ''}
<div class="mt-24">${tiles([
		{ value: String(DEVICES.length), label: 'Controllers' },
		{ value: String(answering.length), label: 'Answering' },
		{ value: String(offline.length), label: 'Not answering' },
		{ value: String(degraded.length), label: 'Reporting a fault' },
		{ value: `${onCurrent} of ${DEVICES.length}`, label: `On ${current ? current.version : '—'}` },
		{ value: String(active), label: 'Active alarms' }
	])}</div>
${offline.length || degraded.length ? `<div class="mt-24">${group({
		label: 'Needs Attention',
		count: n(offline.length + degraded.length, 'controller', 'controllers'),
		note: 'A controller that stops answering keeps its last known state in the platform, which is why the row still has a firmware and a point count.',
		body: offline.concat(degraded).map(deviceRow).join('')
	})}</div>` : ''}
<div class="mt-24">${group({
		label: 'Answering',
		count: n(answering.length, 'controller', 'controllers'),
		note: 'Their clock, their programs and their points are read from the device; nothing on this page is a local copy of a value.',
		body: answering.map(deviceRow).join('')
	})}</div>
<div class="mt-16">${callout('The rows above are this build’s register, not a live read: there is no socket to a controller yet. Discover re-times what the register holds; Add puts a controller in it; diagnosing one reports what is recorded about it.')}</div>`;
}

/** *Firmware* — the mock's `devices/firmware`. */
function firmwareBody(): string {
	const current = FIRMWARE.find((release) => release.state === 'Current') ?? FIRMWARE.find((release) => release.state === 'Staged');
	const behind = DEVICES.filter((device) => current !== undefined && device.firmware !== current.version);
	const staged = FIRMWARE.find((release) => release.state === 'Staged') ?? FIRMWARE.find((release) => release.state === 'Not staged');

	return `${pageHead({
		title: 'Firmware',
		mark: 'package',
		desc: 'Releases the platform knows about, and which controllers run them. Staging writes an image to the device; it does not flash anything until the device is told to restart.',
		actions: button('Stage Update', 'temcoTools.devices.stage', { kind: 'primary', mark: 'download' }) + button('Check for Releases', 'temcoTools.devices.checkReleases', { mark: 'refresh' })
	})}
${group({
		label: 'Releases',
		count: n(FIRMWARE.length, 'release', 'releases'),
		note: 'A release is a file the platform holds; how many controllers run it is a fact about the fleet, not about the file.',
		body: FIRMWARE.map((release) => `<div class="record-row">
	${toneMark('package', release.tone === 'neutral' ? undefined : release.tone)}
	<div class="record-row__main">
		<div class="record-row__title"><span class="record-row__name cell-mono">${esc(release.version)}</span><span class="tag">${esc(release.channel)}</span>${release === current ? '<span class="cell-muted">this is what the fleet should run</span>' : ''}</div>
		<div class="record-row__meta"><span>${n(release.devices, 'controller', 'controllers')}</span><span class="cell-mono">${esc(release.size)}</span><span>released ${esc(release.released)}</span></div>
	</div>
	<div class="record-row__state">${badge(release.state, release.tone)}</div>
</div>`).join('')
	})}
${behind.length ? `<div class="mt-24">${group({
		label: 'Behind',
		count: n(behind.length, 'controller', 'controllers'),
		note: `These run something other than ${current ? current.version : 'the current release'}. A controller that is offline cannot be updated until it answers again.`,
		body: behind.map((device) => `<div class="record-row">
	${toneMark('chip', device.status === 'Offline' ? 'err' : device.status === 'Warning' ? 'warn' : 'ok')}
	<div class="record-row__main">
		<div class="record-row__title"><span class="record-row__name">${esc(device.name)}</span></div>
		<div class="record-row__meta"><span class="cell-mono">${esc(device.firmware)} → ${esc(current ? current.version : '—')}</span><span>${esc(device.status)}</span><span>${esc(device.last)}</span></div>
	</div>
	<div class="record-row__state"></div>
	${button('Stage', 'temcoTools.devices.stage', { small: true, kind: 'ghost', args: [device.serial] })}
</div>`).join('')
	})}</div>` : ''}
<div class="mt-24">${callout(
		staged
			? `<b>${esc(staged.version)} is a ${esc(staged.channel.toLowerCase())}.</b> Staging it on a production controller is refused unless the workspace is switched to the Preview channel in Settings.`
			: 'A staged image survives a power cut; the controller boots the old firmware until the new one is confirmed.',
		'warn'
	)}</div>`;
}

/** *Health & Alarms* — the mock's `devices/health`. */
function healthBody(): string {
	const active = ALARMS.filter((alarm) => alarm.state === 'Active');
	const acknowledged = ALARMS.filter((alarm) => alarm.state === 'Acknowledged');
	const cleared = ALARMS.filter((alarm) => alarm.state === 'Cleared');
	const high = active.filter((alarm) => alarm.priority === 'High').length;

	const alarmRow = (alarm: typeof ALARMS[number]): string => {
		const tone = alarm.priority === 'High' ? 'err' : alarm.priority === 'Medium' ? 'warn' : 'info';
		return `<div class="record-row${alarm.state === 'Active' ? '' : ' record-row--static'}">
	${toneMark('alert', tone)}
	<div class="record-row__main">
		<div class="record-row__title"><span class="record-row__name">${esc(alarm.message)}</span></div>
		<div class="record-row__meta"><span>${esc(alarm.device)}</span><span class="cell-mono">${esc(alarm.time)}</span><span>${esc(alarm.priority)} priority</span></div>
	</div>
	<div class="record-row__state">${badge(alarm.state, alarm.state === 'Active' ? 'err' : alarm.state === 'Acknowledged' ? 'warn' : 'ok')}</div>
	${alarm.state === 'Active'
				? button('Acknowledge', 'temcoTools.devices.ack', { small: true, args: [alarm.time, alarm.device] })
				: `<span class="cell-muted">${alarm.state === 'Acknowledged' ? 'seen by a person' : 'cleared on the device'}</span>`}
</div>`;
	};

	return `${pageHead({
		title: 'Health & Alarms',
		mark: 'alert',
		desc: 'What the fleet reports right now, newest first. Acknowledging does not clear a condition — it records that a person has seen it, and the device keeps reporting until the cause is gone.',
		actions: button('Acknowledge All', 'temcoTools.devices.ackAll', { mark: 'check' })
	})}
<div class="mt-16">${tiles([
		{ value: String(active.length), label: 'Active' },
		{ value: String(high), label: 'High priority' },
		{ value: String(acknowledged.length), label: 'Acknowledged' },
		{ value: String(cleared.length), label: 'Cleared today' }
	])}</div>
${active.length ? `<div class="mt-24">${group({
		label: 'Active',
		count: n(active.length, 'condition', 'conditions'),
		note: 'Each of these is still true on the device. The row disappears when the device says it is not.',
		body: active.map(alarmRow).join('')
	})}</div>` : ''}
${acknowledged.length ? `<div class="mt-24">${group({ label: 'Acknowledged', count: n(acknowledged.length, 'condition', 'conditions'), body: acknowledged.map(alarmRow).join('') })}</div>` : ''}
${cleared.length ? `<div class="mt-24">${group({ label: 'Cleared Today', count: n(cleared.length, 'condition', 'conditions'), body: cleared.map(alarmRow).join('') })}</div>` : ''}`;
}

/** *Schedules* — the mock's `devices/schedules`. */
function schedulesBody(): string {
	const overridden = SCHEDULE_ROWS.filter((row) => row.state === 'Overridden');

	const entryRow = (entry: typeof SCHEDULE_ENTRIES[number]): string => `<div class="record-row record-row--static">
	${toneMark('list')}
	<div class="record-row__main">
		<div class="record-row__title"><span class="record-row__name cell-mono">${esc(entry.window)}</span></div>
		<div class="record-row__meta"><span>${esc(entry.note)}</span></div>
	</div>
	<div class="record-row__state">${entry.state ? badge(entry.state, 'warn') : ''}</div>
	<div class="record-row__state"></div>
</div>`;

	return `${pageHead({
		title: 'Schedules',
		mark: 'clock',
		desc: 'Schedules the fleet holds, and when each one runs next. Editing one writes it to the device, not to a local copy — a schedule that has not reached the device has not changed.',
		actions: button('New Schedule', 'temcoTools.devices.newSchedule', { kind: 'primary', mark: 'plus' })
	})}
${group({
		label: 'Schedule Objects',
		count: n(SCHEDULE_ROWS.length, 'schedule', 'schedules') + (overridden.length ? ` · ${n(overridden.length, 'override', 'overrides')}` : ''),
		note: 'Times are the controller’s own clock, which drifts if it is not synchronised after a power cut.',
		body: SCHEDULE_ROWS.map((row) => `<div class="record-row">
	${toneMark('clock', row.tone === 'neutral' ? undefined : row.tone)}
	<div class="record-row__main">
		<div class="record-row__title"><span class="record-row__name">${esc(row.name)}</span></div>
		<div class="record-row__meta"><span>${esc(row.device)}</span><span>${n(row.entries, 'entry', 'entries')}</span><span>next ${esc(row.next)}</span></div>
	</div>
	<div class="record-row__state">${badge(row.state, row.tone)}</div>
	${button('Edit', 'temcoTools.devices.editSchedule', { small: true, kind: 'ghost', args: [row.name] })}
</div>`).join('')
	})}
<div class="mt-24">${group({
		label: 'Weekday Occupancy · T3-BB',
		count: '5 days',
		body: SCHEDULE_ENTRIES.map(entryRow).join('')
	})}</div>
<div class="mt-16">${callout('Editing a schedule toggles it in this register, which is what the page then shows. The write that matters is the one to the controller, and this build has no connection to make it.')}</div>`;
}

/** *Trend Logs* — the mock's `devices/trends`. */
function trendsBody(): string {
	const samples = TREND_LOGS.reduce((total, log) => total + log.samples, 0);

	return `${pageHead({
		title: 'Trend Logs',
		mark: 'chart',
		desc: 'Samples the controllers kept. A trend log lives on its device until it is read; reading one copies it into the platform, and the device keeps sampling either way.',
		actions: button('Read All', 'temcoTools.devices.readTrends', { kind: 'primary', mark: 'download' })
	})}
<div class="grid grid--3">${TREND_CARDS.map((card) => `<div class="card card--plain">
	<div class="card__head"><span class="card__icon">${icon(card.mark)}</span><div class="card__title">${esc(card.title)}</div></div>
	<p class="card__desc">${esc(card.desc)}</p>
	${sparkline(card.values, card.tone)}
	<div class="cell-muted" style="font-size:11px;margin-top:6px">${esc(card.note)}</div>
</div>`).join('')}</div>
<div class="mt-24">${group({
		label: 'On the Fleet',
		count: `${n(TREND_LOGS.length, 'log', 'logs')} · ${samples.toLocaleString('en-US')} samples`,
		note: 'A buffer at 90 % or more is a log nobody has read in a while: the device overwrites its oldest samples to keep sampling.',
		body: TREND_LOGS.map((log) => `<div class="record-row">
	${toneMark('chart', log.tone)}
	<div class="record-row__main">
		<div class="record-row__title"><span class="record-row__name">${esc(log.name)}</span></div>
		<div class="record-row__meta"><span>${esc(log.device)}</span><span>${log.samples.toLocaleString('en-US')} samples</span><span class="cell-mono">${esc(log.interval)}</span><span>read ${esc(log.read)}</span></div>
	</div>
	<div class="record-row__state"><div style="min-width:90px">${bar(log.used, log.used > 85 ? 'warn' : 'ok')}</div></div>
	${button('Read', 'temcoTools.devices.readTrend', { small: true, kind: 'ghost', args: [log.name] })}
</div>`).join('')
	})}</div>`;
}

/** *Backups* — the mock's `devices/backups`. */
function backupsBody(): string {
	const row = (backup: BackupRow): string => `<div class="record-row${backup.stale ? ' record-row--static' : ''}">
	${toneMark('package', backup.tone)}
	<div class="record-row__main">
		<div class="record-row__title"><span class="record-row__name">${esc(backup.device)}</span></div>
		<div class="record-row__meta"><span class="cell-mono">${esc(backup.when)}</span><span class="cell-mono">${esc(backup.size)}</span><span>firmware ${esc(backup.firmware)}</span><span>${esc(backup.kind)}</span></div>
	</div>
	<div class="record-row__state">${backup.stale ? badge('Oldest', 'warn') : ''}</div>
	${backup.stale ? '<span class="cell-muted">nothing to restore from</span>' : button('Restore', 'temcoTools.devices.restore', { small: true, kind: 'ghost', args: [backup.device] })}
</div>`;

	return `${pageHead({
		title: 'Backups',
		mark: 'download',
		desc: 'A backup is the controller’s own database, copied out. Restoring writes it back and restarts the device, which is why the platform keeps a rollback copy first.',
		actions: button('Back Up All', 'temcoTools.devices.backupAll', { kind: 'primary', mark: 'download' })
	})}
${group({
		label: 'Copies',
		count: n(DEVICE_BACKUPS.length, 'backup', 'backups'),
		note: 'Newest first, one row per controller. A controller that has not answered since October 3 has nothing younger to offer.',
		body: DEVICE_BACKUPS.map(row).join('')
	})}
<div class="mt-16">${callout('Restoring is a write to the device and restarts it. The platform copies the current database aside before it writes, and that copy is what a second restore would use.', 'warn')}</div>`;
}

const BODIES: { [id: string]: () => string } = {
	all: allBody,
	firmware: firmwareBody,
	health: healthBody,
	schedules: schedulesBody,
	trends: trendsBody,
	backups: backupsBody
};

/** Fires when the register changes, so the two side-bar views can re-read the counts they show. */
const changedEmitter = new vscode.EventEmitter<void>();
export const onDidChangeDevices: vscode.Event<void> = changedEmitter.event;

/** The six pages, one panel each, kept open so a second visit reveals the tab rather than stacking another. */
export class DevicesPages {
	private readonly panels = new Map<string, vscode.WebviewPanel>();

	constructor(private readonly context: vscode.ExtensionContext) { }

	open(id: string, restored?: vscode.WebviewPanel): void {
		const definition = DEVICE_PAGES.find((entry) => entry.id === id);
		const body = BODIES[id];
		if (!definition || !body) {
			return;
		}
		const existing = this.panels.get(id);
		if (existing) {
			existing.reveal(pageColumn());
			existing.webview.html = this.document(definition, body);
			return;
		}
		// A restored tab is drawn into rather than replaced: it keeps its place in the strip.
		const panel = restored ?? vscode.window.createWebviewPanel(definition.viewType, definition.label, pageColumn(), {
			enableScripts: true,
			localResourceRoots: []
		});
		// The mock's container has its own glyph; the devices drawing is the one the side bar already uses.
		panel.webview.options = { enableScripts: true, localResourceRoots: [] };
		panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'devices.svg');
		panel.webview.html = this.document(definition, body);
		panel.webview.onDidReceiveMessage((message: PageMessage) => {
			if (message.type !== 'command' || typeof message.command !== 'string') {
				return;
			}
			// The page sends its arguments as one array — `data-args` is JSON — and a command wants them spread:
			// `temcoTools.devices.ack` takes a time *and* a device, and half of that pair is not an acknowledgement.
			const args = Array.isArray(message.args) ? message.args : message.args === undefined ? [] : [message.args];
			void vscode.commands.executeCommand(message.command, ...args);
		});
		this.panels.set(id, panel);
		panel.onDidDispose(() => this.panels.delete(id));
	}

	/** Re-draws every page that is open — a write on one is a fact on the others. */
	refresh(): void {
		for (const [id, panel] of this.panels) {
			const body = BODIES[id];
			const definition = DEVICE_PAGES.find((entry) => entry.id === id);
			if (body && definition) {
				panel.webview.html = this.document(definition, body);
			}
		}
	}

	dispose(): void {
		for (const panel of this.panels.values()) {
			panel.dispose();
		}
		this.panels.clear();
	}

	private document(definition: DevicePage, body: () => string): string {
		return page(body(), { title: definition.label, script: commandScript });
	}
}

/* ------------------------------------------------------------------ what a button does */

/**
 * The actions behind the pages' buttons, and the two views' commands.
 *
 * Each one is deliberately written as *ask → change → say what changed*, because that is the part that survives the
 * day a device connection replaces the register: the questions a person is asked, and the sentence the window says
 * afterwards, are the design. Only the assignment in the middle is temporary.
 */
export function registerDevices(context: vscode.ExtensionContext): { pages: DevicesPages; disposables: vscode.Disposable[] } {
	const pages = new DevicesPages(context);
	const changed = (): void => {
		pages.refresh();
		changedEmitter.fire();
	};

	const find = (serial?: unknown): typeof DEVICES[number] | undefined =>
		DEVICES.find((device) => device.serial === Number(serial) || String(device.serial) === String(serial));

	/** The release the fleet should run: whatever the register marks Current, else what was just staged. */
	const currentRelease = (): typeof FIRMWARE[number] | undefined => FIRMWARE.find((release) => release.state === 'Current') ?? FIRMWARE.find((release) => release.state === 'Staged');

	const commands: vscode.Disposable[] = [
		// ---- the six pages' own commands, and the side bar's rows
		...DEVICE_PAGES.map((definition) =>
			vscode.commands.registerCommand(definition.command, () => pages.open(definition.id))
		),

		// ---- Devices
		vscode.commands.registerCommand('temcoTools.devices.discover', async () => {
			const answering = DEVICES.filter((device) => device.status !== 'Offline');
			answering.forEach((device) => {
				device.last = 'just now';
			});
			changed();
			// Said out loud, because the button does not scan: it re-times what the register already holds, and a
			// page that quietly changed its own timestamps would be claiming a discovery nobody made.
			await vscode.window.showInformationMessage(
				`Temco Devices: ${n(answering.length, 'controller', 'controllers')} answered on the register. There is no discovery service in this build, so nothing new was found.`
			);
		}),

		vscode.commands.registerCommand('temcoTools.devices.add', async () => {
			const address = await vscode.window.showInputBox({
				title: 'Add a Controller by Address',
				prompt: 'An IP address on this segment, or a serial number already on the wire',
				placeHolder: '192.168.10.60'
			});
			if (address === undefined || address.trim().length === 0) {
				return;
			}
			const value = address.trim();
			if (DEVICES.some((device) => device.ip === value || String(device.serial) === value)) {
				await vscode.window.showWarningMessage(`Temco Devices: ${value} is already in the register.`);
				return;
			}
			DEVICES.push({
				serial: Number(value.replace(/\D/g, '')) || 0,
				name: value,
				product: 'Unknown',
				ip: value,
				status: 'Offline',
				firmware: '—',
				points: 0,
				alarms: 0,
				last: 'never'
			});
			changed();
			await vscode.window.showInformationMessage(
				`Temco Devices: ${value} added. It stays Offline — and keeps the place it would have in the fleet — until it answers.`
			);
		}),

		vscode.commands.registerCommand('temcoTools.devices.diagnose', async (serial?: unknown) => {
			const device = find(serial);
			if (!device) {
				return;
			}
			const alarms = ALARMS.filter((alarm) => alarm.device === device.name && alarm.state !== 'Cleared');
			await vscode.window.showInformationMessage(`Temco Devices: ${device.name}`, {
				detail: [
					`Serial ${device.serial} · ${device.product} · ${device.status}`,
					`Address ${device.ip} · firmware ${device.firmware} · ${n(device.points, 'point', 'points')}`,
					`Last seen ${device.last}`,
					alarms.length ? `Open conditions: ${alarms.map((alarm) => `${alarm.message} (${alarm.state})`).join(', ')}` : 'No open conditions in the register.'
				].join('\n')
			});
		}),

		// ---- Firmware
		vscode.commands.registerCommand('temcoTools.devices.stage', async (target?: unknown) => {
			const current = currentRelease();
			const behind = DEVICES.filter((device) => current !== undefined && device.firmware !== current.version);
			const chosen = find(target);
			const release = FIRMWARE.find((entry) => entry.state === 'Staged') ?? FIRMWARE.find((entry) => entry.state === 'Not staged') ?? current;
			if (!release) {
				return;
			}
			const targets = chosen ? [chosen] : behind;
			if (targets.length === 0) {
				await vscode.window.showInformationMessage(`Temco Devices: every controller already runs ${current ? current.version : 'the current release'}.`);
				return;
			}
			const answer = await vscode.window.showWarningMessage(
				`Stage ${release.version} (${release.channel}) on ${n(targets.length, 'controller', 'controllers')}?`,
				{
					modal: true,
					detail: `Writes the image beside the current database on ${targets.map((device) => device.name).join(', ')}. Nothing restarts until a controller is told to, and a controller boots the old firmware until the new image is confirmed.`
				},
				'Stage'
			);
			if (answer !== 'Stage') {
				return;
			}
			// The image is on the way to the device, not on it: the release says staged, the controllers still say
			// what they boot from.
			release.state = 'Staged';
			changed();
			await vscode.window.showInformationMessage(
				`Temco Devices: ${release.version} staged on ${n(targets.length, 'controller', 'controllers')}. Nothing has restarted.`
			);
		}),

		vscode.commands.registerCommand('temcoTools.devices.checkReleases', async () => {
			const newest = FIRMWARE[0];
			await vscode.window.showInformationMessage(
				newest
					? `Temco Devices: the newest release the platform holds is ${newest.version} (${newest.channel}), released ${newest.released}. This build does not reach a release server.`
					: 'Temco Devices: the register holds no release.'
			);
		}),

		// ---- Health & Alarms
		vscode.commands.registerCommand('temcoTools.devices.ack', async (time?: unknown, device?: unknown) => {
			const alarm = ALARMS.find((entry) => entry.time === String(time) && entry.device === String(device));
			if (!alarm) {
				return;
			}
			alarm.state = 'Acknowledged';
			changed();
			await vscode.window.showInformationMessage(
				`Temco Devices: ${alarm.message} acknowledged on ${alarm.device}. The condition is still true on the device.`
			);
		}),

		vscode.commands.registerCommand('temcoTools.devices.ackAll', async () => {
			const active = ALARMS.filter((alarm) => alarm.state === 'Active');
			if (active.length === 0) {
				await vscode.window.showInformationMessage('Temco Devices: nothing is active.');
				return;
			}
			active.forEach((alarm) => {
				alarm.state = 'Acknowledged';
			});
			changed();
			await vscode.window.showInformationMessage(
				`Temco Devices: ${n(active.length, 'condition', 'conditions')} acknowledged. Acknowledging is not clearing — the devices keep reporting until the causes are gone.`
			);
		}),

		// ---- Schedules
		vscode.commands.registerCommand('temcoTools.devices.newSchedule', async () => {
			const name = await vscode.window.showInputBox({
				title: 'New Schedule',
				prompt: 'A name for the schedule object',
				placeHolder: 'Night setback'
			});
			if (name === undefined || name.trim().length === 0) {
				return;
			}
			const device = DEVICES[0]?.name ?? '—';
			SCHEDULE_ROWS.push({ device, name: name.trim(), next: '—', state: 'Disabled', tone: 'neutral', entries: 1 });
			changed();
			await vscode.window.showInformationMessage(
				`Temco Devices: “${name.trim()}” created on ${device}, disabled. It runs nothing until someone enables it and the controller confirms it has the program.`
			);
		}),

		vscode.commands.registerCommand('temcoTools.devices.editSchedule', async (name?: unknown) => {
			const row = SCHEDULE_ROWS.find((entry) => entry.name === String(name));
			if (!row) {
				return;
			}
			const enabling = row.state === 'Disabled';
			row.state = enabling ? 'Enabled' : 'Disabled';
			row.tone = enabling ? 'ok' : 'neutral';
			changed();
			await vscode.window.showInformationMessage(
				`Temco Devices: “${row.name}” ${enabling ? 'enabled' : 'disabled'} in the register on ${row.device}. A schedule the controller has not confirmed is not running.`
			);
		}),

		// ---- Trend Logs
		vscode.commands.registerCommand('temcoTools.devices.readTrends', async () => {
			const samples = TREND_LOGS.reduce((total, log) => total + log.samples, 0);
			TREND_LOGS.forEach((log) => {
				log.read = 'just now';
				log.state = 'Read';
				log.tone = 'ok';
				log.used = 0;
			});
			changed();
			await vscode.window.showInformationMessage(
				`Temco Devices: ${n(TREND_LOGS.length, 'log', 'logs')} read · ${samples.toLocaleString('en-US')} samples copied into the platform. The devices keep sampling.`
			);
		}),

		vscode.commands.registerCommand('temcoTools.devices.readTrend', async (name?: unknown) => {
			const log = TREND_LOGS.find((entry) => entry.name === String(name));
			if (!log) {
				return;
			}
			log.read = 'just now';
			log.state = 'Read';
			log.tone = 'ok';
			log.used = 0;
			changed();
			await vscode.window.showInformationMessage(
				`Temco Devices: ${log.name} read — ${log.samples.toLocaleString('en-US')} samples from ${log.device}.`
			);
		}),

		// ---- Backups
		vscode.commands.registerCommand('temcoTools.devices.backupAll', async () => {
			const when = now();
			DEVICE_BACKUPS.forEach((backup) => {
				if (backup.stale) {
					// A controller that has not answered cannot be copied: the row says so rather than pretending.
					return;
				}
				backup.when = when;
				backup.kind = 'manual · requested just now';
			});
			changed();
			const copied = DEVICE_BACKUPS.filter((backup) => !backup.stale).length;
			await vscode.window.showInformationMessage(
				`Temco Devices: ${n(copied, 'controller', 'controllers')} copied. ${DEVICE_BACKUPS.filter((backup) => backup.stale).map((backup) => backup.device).join(', ') || 'No controller'} did not answer, so it is unchanged.`
			);
		}),

		vscode.commands.registerCommand('temcoTools.devices.restore', async (device?: unknown) => {
			const backup = DEVICE_BACKUPS.find((entry) => entry.device === String(device));
			if (!backup) {
				return;
			}
			const answer = await vscode.window.showWarningMessage(
				`Restore ${backup.device} from ${backup.when}?`,
				{
					modal: true,
					detail: `The database in the copy (firmware ${backup.firmware}, ${backup.size}) is written back to the controller, which then restarts. The current database is copied aside first, so a second restore can undo this one.`
				},
				'Restore and Restart'
			);
			if (answer !== 'Restore and Restart') {
				return;
			}
			backup.kind = `restored ${now()} · rollback copy kept`;
			changed();
			await vscode.window.showInformationMessage(
				`Temco Devices: ${backup.device} restored from ${backup.when} and restarted. The database it replaced is kept as the rollback copy.`
			);
		})
	];

	return { pages, disposables: commands };
}
