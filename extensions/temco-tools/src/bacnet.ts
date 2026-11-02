// BACnet Studio — the five surfaces behind the container, rebuilt from the mock.
//
// Source: `docs/mock/js/views.industrial.js` (`bacnet/discovery`, `bacnet/objects`, `bacnet/alarms`,
// `bacnet/trendlogs`, `bacnet/schedules`) and the mock's side bar, which splits them into **Network** and
// **History** (`docs/mock/js/data.js`).
//
// The event log is the same register the Devices pages read: the mock has one `alarms` table and shows it twice —
// once as a fleet summary, once as the wire. Acknowledging on either page therefore acknowledges once, which is what
// a person means by it.

import * as vscode from 'vscode';
import { ALARMS, BACNET_OBJECTS, HOSTS } from './data';
import {
	BACNET_SCHEDULES, BACNET_TREND_LOGS, lastScan, objectDevice, objectsReadAt, recordObjectRead, recordScan, scanRange, setObjectDevice
} from './bacnetSample';
import { PageMessage, commandScript, esc, icon, page, pageColumn, toneMark } from './ui';

/** One surface of the BACnet container: the row, the command, and the page it draws. */
export interface BacnetPage {
	id: string;
	label: string;
	note: string;
	mark: string;
	command: string;
	viewType: string;
	group: 'network' | 'history';
}

export const BACNET_PAGES: BacnetPage[] = [
	{ id: 'discovery', label: 'Discovery', note: 'who answers on the network, and what they say they are', mark: 'search', command: 'temcoTools.bacnet.discovery', viewType: 'temcoTools.bacnet.discovery', group: 'network' },
	{ id: 'objects', label: 'Object Browser', note: 'the objects one device exposes', mark: 'list', command: 'temcoTools.bacnet.objects', viewType: 'temcoTools.bacnet.objects', group: 'network' },
	{ id: 'alarms', label: 'Alarms', note: 'event notifications, as the devices sent them', mark: 'warning', command: 'temcoTools.bacnet.alarms', viewType: 'temcoTools.bacnet.alarms', group: 'network' },
	{ id: 'trendlogs', label: 'Trend Logs', note: 'log objects and their buffers', mark: 'graph', command: 'temcoTools.bacnet.trendlogs', viewType: 'temcoTools.bacnet.trendlogs', group: 'history' },
	{ id: 'schedules', label: 'Schedules', note: 'schedule objects on the network', mark: 'clock', command: 'temcoTools.bacnet.schedules', viewType: 'temcoTools.bacnet.schedules', group: 'history' }
];

/* ------------------------------------------------------------------ page vocabulary */

const button = (label: string, command: string, options: { kind?: 'primary' | 'ghost'; mark?: string; args?: unknown; small?: boolean } = {}): string =>
	`<button type="button" class="btn${options.small ? ' btn--sm' : ''}${options.kind ? ` btn--${options.kind}` : ''}" data-command="${command}"${options.args === undefined ? '' : ` data-args="${esc(JSON.stringify(options.args))}"`}>${options.mark ? icon(options.mark) : ''}<span>${esc(label)}</span></button>`;

const badge = (text: string, tone?: string): string =>
	`<span class="badge${tone && tone !== 'neutral' ? ` badge--${tone}` : ''}">${esc(text)}</span>`;

const pageHead = (options: { title: string; mark: string; desc: string; actions: string }): string =>
	`<div class="page-head"><div class="page-head__main"><h1 class="page-head__title">${icon(options.mark)}${esc(options.title)}</h1><p class="page-head__desc">${esc(options.desc)}</p></div><div class="page-head__actions">${options.actions}</div></div>`;

const group = (options: { label: string; count?: string; note?: string; body: string }): string =>
	`<div class="group-head"><span class="group-head__label">${esc(options.label)}</span><span class="group-head__rule"></span>${options.count ? `<span class="group-head__count">${esc(options.count)}</span>` : ''}</div>${options.note ? `<p class="group-note">${esc(options.note)}</p>` : ''}<div class="record-list">${options.body}</div>`;

const tiles = (items: { value: string; label: string }[]): string =>
	`<div class="tiles">${items.map((item) => `<div class="tile"><span class="tile__value">${esc(item.value)}</span><span class="tile__label">${esc(item.label)}</span></div>`).join('')}</div>`;

const card = (options: { title: string; desc?: string; body: string; foot?: string }): string =>
	`<div class="card card--plain"><div class="card__head"><div class="card__title">${esc(options.title)}</div></div>${options.desc ? `<p class="card__desc">${esc(options.desc)}</p>` : ''}${options.body}${options.foot ? `<div class="card__foot">${options.foot}</div>` : ''}</div>`;

const callout = (html: string, kind: 'warn' | 'ok' | 'info' = 'info'): string =>
	`<div class="callout${kind === 'info' ? '' : ` callout--${kind}`}">${icon(kind === 'warn' ? 'alert' : kind === 'ok' ? 'check' : 'info')}<div>${html}</div></div>`;

const bar = (percent: number, tone: 'ok' | 'warn'): string =>
	`<span class="bar"><span class="bar__fill bar__fill--${tone}" style="width:${percent}%"></span></span>`;

const n = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/* ------------------------------------------------------------------ the five pages */

/** *Discovery* — the mock's `bacnet/discovery`. */
function discoveryBody(): string {
	const answering = HOSTS.filter((host) => host.state === 'Online');
	const foreign = HOSTS.filter((host) => host.vendor !== 'Temco');
	const bacnetIp = HOSTS.filter((host) => host.protocol === 'BACnet/IP');

	return `${pageHead({
		title: 'BACnet Discovery',
		mark: 'search',
		desc: 'Who answers on the network, and what they say they are. Discovery is read-only: a Who-Is writes nothing to a device, and a device that does not answer is still in the fleet.',
		actions: button('Start Scan', 'temcoTools.bacnet.scan', { kind: 'primary', mark: 'search' }) + button('Who-Is Range', 'temcoTools.bacnet.whois', { mark: 'filter' })
	})}
<div class="toolbar">
	<input class="input" value="${esc(scanRange)}" aria-label="Range" readonly>
	<select class="select" aria-label="Protocol"><option>BACnet/IP</option><option>BACnet MS/TP</option><option>BACnet/SC</option></select>
	<span class="toolbar__spacer"></span>
	<span class="cell-muted" style="font-size:12px">${n(HOSTS.length, 'host', 'hosts')} · ${esc(lastScan)}</span>
</div>
<div class="mt-16">${tiles([
		{ value: String(HOSTS.length), label: 'Answered' },
		{ value: String(answering.length), label: 'Online' },
		{ value: String(foreign.length), label: 'Third-party' },
		{ value: String(bacnetIp.length), label: 'BACnet/IP' }
	])}</div>
<div class="mt-24">${group({
		label: 'Devices On The Wire',
		count: n(HOSTS.length, 'host', 'hosts'),
		note: 'The instance number is what BACnet addresses the device by; the IP is only how this segment reaches it.',
		body: HOSTS.map((host) => `<div class="record-row">
	${toneMark('globe', host.tone)}
	<div class="record-row__main">
		<div class="record-row__title"><span class="record-row__name">${esc(host.name)}</span><span class="tag">${esc(host.protocol)}</span>${host.vendor !== 'Temco' ? badge('Third-party', 'neutral') : ''}</div>
		<div class="record-row__meta"><span class="cell-mono">${esc(host.ip)}</span><span class="cell-mono">${esc(host.mac)}</span><span>${esc(host.vendor)}</span></div>
	</div>
	<div class="record-row__state">${badge(host.state, host.tone)}</div>
	${host.protocol === 'BACnet/IP'
				? button('Objects', 'temcoTools.bacnet.openObjects', { small: true, kind: 'ghost', args: [host.name] })
				: '<span class="cell-muted">no objects</span>'}
</div>`).join('')
	})}</div>
<div class="mt-16">${callout('1,204 objects were read across the answering devices, 88 of them writable. Reading an object does not keep a copy: the value is asked for again the next time a page needs it.')}</div>
<div class="mt-16">${callout('Discovery here re-times this build’s host register. There is no BACnet stack behind it, so a scan cannot find a device that is not already in it.')}</div>`;
}

/** *Object Browser* — the mock's `bacnet/objects`. */
function objectsBody(): string {
	const fault = BACNET_OBJECTS.filter((object) => object.flags === 'Fault');

	return `${pageHead({
		title: 'Object Browser',
		mark: 'list',
		desc: 'The objects one device exposes, read over BACnet. A value written here goes to the device; the platform keeps no copy of it.',
		actions: button('Read All', 'temcoTools.bacnet.readObjects', { mark: 'refresh' }) + button('Export', 'temcoTools.bacnet.exportObjects', { mark: 'download' })
	})}
${group({
		label: `Objects · ${objectDevice}`,
		count: n(BACNET_OBJECTS.length, 'object', 'objects') + (fault.length ? ` · ${n(fault.length, 'fault', 'faults')}` : ''),
		note: `The instance is the object’s own id; the name is what the device calls it. Values as of the last read — ${esc(objectsReadAt)}.`,
		body: BACNET_OBJECTS.map((object) => `<div class="record-row">
	${toneMark('server', object.flags === 'Fault' ? 'warn' : undefined)}
	<div class="record-row__main">
		<div class="record-row__title"><span class="record-row__name cell-mono">${esc(object.instance)}</span><span>${esc(object.name)}</span></div>
		<div class="record-row__meta"><span>${esc(object.type)}</span><span class="cell-mono">${esc(object.units)}</span></div>
	</div>
	<div class="record-row__state cell-mono">${esc(object.value)}</div>
	${object.flags === 'Fault' ? badge('Fault', 'warn') : '<span class="cell-muted">no-fault</span>'}
</div>`).join('')
	})}
<div class="mt-24 grid grid--2">
	${card({
		title: 'AV-101 · Supply Air Temp',
		body: `<dl class="kv"><dt>Object id</dt><dd class="cell-mono">analog-value, 101</dd><dt>Present value</dt><dd class="cell-mono">18.4 °C</dd><dt>COV increment</dt><dd class="cell-mono">0.5</dd><dt>Priority array</dt><dd class="cell-mono">— — — — — — — — — — — — 18.4 — — —</dd><dt>Reliability</dt><dd>no-fault-detected</dd></dl>`,
		foot: button('Write Value', 'temcoTools.bacnet.writeObject', { small: true }) + button('Trend', 'temcoTools.bacnet.trendlogs', { small: true, kind: 'ghost' })
	})}
	${card({
		title: 'BV-31 · Filter Alarm',
		desc: 'The one object on this device that reports a fault.',
		body: `<dl class="kv"><dt>Object id</dt><dd class="cell-mono">binary-value, 31</dd><dt>Present value</dt><dd class="cell-mono">inactive</dd><dt>Status flags</dt><dd class="cell-mono">fault</dd><dt>Writable</dt><dd>yes — priority 8</dd></dl>`,
		foot: `${badge('Fault', 'warn')}<span>a fault here can mean the input is open circuit</span>`
	})}
</div>`;
}

/** *Alarms* — the mock's `bacnet/alarms`. */
function alarmsBody(): string {
	const row = (alarm: typeof ALARMS[number]): string => {
		const tone = alarm.priority === 'High' ? 'err' : alarm.priority === 'Medium' ? 'warn' : 'info';
		return `<div class="record-row${alarm.state === 'Active' ? '' : ' record-row--static'}">
	${toneMark('alert', tone)}
	<div class="record-row__main">
		<div class="record-row__title"><span class="record-row__name">${esc(alarm.message)}</span></div>
		<div class="record-row__meta"><span class="cell-mono">${esc(alarm.time)}</span><span>${esc(alarm.device)}</span><span>${esc(alarm.priority)} priority</span></div>
	</div>
	<div class="record-row__state">${badge(alarm.state, alarm.state === 'Active' ? 'err' : alarm.state === 'Acknowledged' ? 'warn' : 'ok')}</div>
	${alarm.state === 'Active' ? button('Acknowledge', 'temcoTools.bacnet.ack', { small: true, args: [alarm.time, alarm.device] }) : '<span class="cell-muted">—</span>'}
</div>`;
	};

	return `${pageHead({
		title: 'BACnet Alarms',
		mark: 'alert',
		desc: 'Event notifications as the devices sent them, with the acknowledgement the platform owes the device. Acknowledging answers the device; it does not clear the condition.',
		actions: button('Acknowledge All', 'temcoTools.bacnet.ackAll', { mark: 'check' })
	})}
${group({
		label: 'Event Log',
		count: n(ALARMS.length, 'event', 'events'),
		note: 'One row per notification received, newest first — this is the wire, not a summary.',
		body: ALARMS.map(row).join('')
	})}
<div class="mt-16">${callout('An event notification carries the state the device had when it sent it. If the platform was not listening, that event is gone — the device does not resend it.')}</div>`;
}

/** *Trend Logs* — the mock's `bacnet/trendlogs`. */
function trendlogsBody(): string {
	return `${pageHead({
		title: 'BACnet Trend Logs',
		mark: 'chart',
		desc: 'Trend logs the devices hold. Reading one transfers its buffer over BACnet; the device keeps sampling either way, so a late read is a late copy, not a lost one.',
		actions: button('Read Buffer', 'temcoTools.bacnet.readBuffer', { kind: 'primary', mark: 'download' })
	})}
${group({
		label: 'Log Objects',
		count: n(BACNET_TREND_LOGS.length, 'log', 'logs'),
		body: BACNET_TREND_LOGS.map((log) => `<div class="record-row">
	${toneMark('chart', log.used > 85 ? 'warn' : undefined)}
	<div class="record-row__main">
		<div class="record-row__title"><span class="record-row__name">${esc(log.name)}</span><span class="cell-mono cell-muted">${esc(log.object)}</span></div>
		<div class="record-row__meta"><span>${log.samples.toLocaleString('en-US')} samples</span><span>${log.used > 85 ? 'buffer nearly full' : `buffer ${log.used} %`}</span><span>last read ${esc(log.read)}</span></div>
	</div>
	<div class="record-row__state"><div style="min-width:90px">${bar(log.used, log.used > 85 ? 'warn' : 'ok')}</div></div>
	${button('Open', 'temcoTools.bacnet.openTrend', { small: true, kind: 'ghost', args: [log.name] })}
</div>`).join('')
	})}
<div class="mt-16">${callout('There is no BACnet stack in this build: Read Buffer empties the buffers in the register and says so, rather than claiming a transfer.')}</div>`;
}

/** *Schedules* — the mock's `bacnet/schedules`. */
function schedulesBody(): string {
	return `${pageHead({
		title: 'BACnet Schedules',
		mark: 'clock',
		desc: 'Schedule objects on the network, with the weekly entries the device holds. The entries live in the device; this list is what it reported.',
		actions: button('New Schedule', 'temcoTools.bacnet.newSchedule', { kind: 'primary', mark: 'plus' })
	})}
${group({
		label: 'Schedule Objects',
		count: n(BACNET_SCHEDULES.length, 'object', 'objects'),
		body: BACNET_SCHEDULES.map((schedule) => `<div class="record-row">
	${toneMark('clock', schedule.tone === 'neutral' ? undefined : schedule.tone)}
	<div class="record-row__main">
		<div class="record-row__title"><span class="record-row__name">${esc(schedule.name)}</span><span class="cell-mono cell-muted">${esc(schedule.object)}</span></div>
		<div class="record-row__meta"><span>${esc(schedule.device)}</span><span>${n(schedule.entries, 'entry', 'entries')}</span><span>next ${esc(schedule.next)}</span></div>
	</div>
	<div class="record-row__state">${badge(schedule.state, schedule.tone)}</div>
	<div class="record-row__state"></div>
</div>`).join('')
	})}
<div class="mt-16">${callout('A schedule object is the controller’s, not the platform’s: New Schedule writes a row here, and the device has not been told about it until a write reaches it.')}</div>`;
}

const BODIES: { [id: string]: () => string } = {
	discovery: discoveryBody,
	objects: objectsBody,
	alarms: alarmsBody,
	trendlogs: trendlogsBody,
	schedules: schedulesBody
};

/** The five pages, one panel each, kept open so a second visit reveals the tab rather than stacking another. */
export class BacnetPages {
	private readonly panels = new Map<string, vscode.WebviewPanel>();

	constructor(private readonly context: vscode.ExtensionContext) { }

	open(id: string, restored?: vscode.WebviewPanel): void {
		const definition = BACNET_PAGES.find((entry) => entry.id === id);
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
		panel.webview.options = { enableScripts: true, localResourceRoots: [] };
		panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'bacnet.svg');
		panel.webview.html = this.document(definition, body);
		panel.webview.onDidReceiveMessage((message: PageMessage) => {
			if (message.type !== 'command' || typeof message.command !== 'string') {
				return;
			}
			// `data-args` arrives as one array; a command wants them spread — an acknowledgement names a time *and*
			// a device, and half of that pair is not an acknowledgement.
			const args = Array.isArray(message.args) ? message.args : message.args === undefined ? [] : [message.args];
			void vscode.commands.executeCommand(message.command, ...args);
		});
		this.panels.set(id, panel);
		panel.onDidDispose(() => this.panels.delete(id));
	}

	refresh(): void {
		for (const [id, panel] of this.panels) {
			const definition = BACNET_PAGES.find((entry) => entry.id === id);
			const body = BODIES[id];
			if (definition && body) {
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

	private document(definition: BacnetPage, body: () => string): string {
		return page(body(), { title: definition.label, script: commandScript });
	}
}

/* ------------------------------------------------------------------ what a button does */

/** The CSV the Export button copies: the object columns the page shows. */
function objectsCsv(): string {
	const header = 'instance,type,name,units,value,flags';
	const rows = BACNET_OBJECTS.map((object) => [object.instance, object.type, object.name, object.units, object.value, object.flags]
		.map((value) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value))
		.join(','));
	return [header, ...rows].join('\n');
}

export function registerBacnet(context: vscode.ExtensionContext): { pages: BacnetPages; disposables: vscode.Disposable[] } {
	const pages = new BacnetPages(context);
	const changed = (): void => pages.refresh();

	const commands: vscode.Disposable[] = [
		...BACNET_PAGES.map((definition) => vscode.commands.registerCommand(definition.command, () => pages.open(definition.id))),

		// ---- Discovery
		vscode.commands.registerCommand('temcoTools.bacnet.scan', async () => {
			recordScan(scanRange);
			changed();
			const answering = HOSTS.filter((host) => host.state === 'Online');
			await vscode.window.showInformationMessage(
				`Temco BACnet: ${n(answering.length, 'host answered', 'hosts answered')} on ${scanRange}. The scan re-timed this build’s host register; no frame went on the wire.`
			);
		}),

		vscode.commands.registerCommand('temcoTools.bacnet.whois', async () => {
			const range = await vscode.window.showInputBox({
				title: 'Who-Is Range',
				prompt: 'The range a Who-Is is sent across',
				value: scanRange,
				placeHolder: '192.168.10.0/24'
			});
			if (range === undefined || range.trim().length === 0) {
				return;
			}
			recordScan(range.trim());
			changed();
			await vscode.window.showInformationMessage(
				`Temco BACnet: the range is now ${range.trim()}. Start Scan re-times the register against it; there is no stack to send the request.`
			);
		}),

		vscode.commands.registerCommand('temcoTools.bacnet.openObjects', async (hostName?: unknown) => {
			const host = HOSTS.find((entry) => entry.name === String(hostName));
			if (!host) {
				pages.open('objects');
				return;
			}
			if (host.protocol !== 'BACnet/IP') {
				await vscode.window.showInformationMessage(`Temco BACnet: ${host.name} is reachable over ${host.protocol}, so it exposes no BACnet objects.`);
				return;
			}
			setObjectDevice(host.name);
			pages.open('objects');
		}),

		// ---- Object Browser
		vscode.commands.registerCommand('temcoTools.bacnet.readObjects', async () => {
			recordObjectRead();
			changed();
			await vscode.window.showInformationMessage(
				`Temco BACnet: ${n(BACNET_OBJECTS.length, 'object', 'objects')} read from ${objectDevice}. Nothing was kept — the next page that needs a value asks again.`
			);
		}),

		vscode.commands.registerCommand('temcoTools.bacnet.exportObjects', async () => {
			await vscode.env.clipboard.writeText(objectsCsv());
			await vscode.window.showInformationMessage(
				`Temco BACnet: ${n(BACNET_OBJECTS.length, 'object', 'objects')} copied as CSV, with the values from the last read.`
			);
		}),

		vscode.commands.registerCommand('temcoTools.bacnet.writeObject', async () => {
			const value = await vscode.window.showInputBox({
				title: 'Write AV-101 · Supply Air Temp',
				prompt: 'A value at priority 8. The device keeps the value until something else writes the same priority.',
				value: '18.4'
			});
			if (value === undefined || value.trim().length === 0) {
				return;
			}
			const object = BACNET_OBJECTS.find((entry) => entry.instance === 'AV-101');
			if (!object) {
				return;
			}
			object.value = value.trim();
			changed();
			await vscode.window.showInformationMessage(
				`Temco BACnet: AV-101 written ${object.value} in the register. The device has not been written to — this build has no BACnet stack.`
			);
		}),

		// ---- Alarms
		vscode.commands.registerCommand('temcoTools.bacnet.ack', async (time?: unknown, device?: unknown) => {
			const alarm = ALARMS.find((entry) => entry.time === String(time) && entry.device === String(device));
			if (!alarm) {
				return;
			}
			alarm.state = 'Acknowledged';
			changed();
			await vscode.window.showInformationMessage(
				`Temco BACnet: ${alarm.message} acknowledged. The device has been answered; the condition is still true.`
			);
		}),

		vscode.commands.registerCommand('temcoTools.bacnet.ackAll', async () => {
			const active = ALARMS.filter((alarm) => alarm.state === 'Active');
			if (active.length === 0) {
				await vscode.window.showInformationMessage('Temco BACnet: no event is waiting to be answered.');
				return;
			}
			active.forEach((alarm) => {
				alarm.state = 'Acknowledged';
			});
			changed();
			await vscode.window.showInformationMessage(
				`Temco BACnet: ${n(active.length, 'event', 'events')} acknowledged. Acknowledging is not clearing — the devices keep reporting.`
			);
		}),

		// ---- Trend Logs
		vscode.commands.registerCommand('temcoTools.bacnet.readBuffer', async () => {
			const samples = BACNET_TREND_LOGS.reduce((total, log) => total + log.samples, 0);
			BACNET_TREND_LOGS.forEach((log) => {
				log.read = 'just now';
				log.used = 0;
			});
			changed();
			await vscode.window.showInformationMessage(
				`Temco BACnet: ${n(BACNET_TREND_LOGS.length, 'buffer', 'buffers')} read · ${samples.toLocaleString('en-US')} samples copied into the platform. The registers are re-timed; the devices keep sampling.`
			);
		}),

		vscode.commands.registerCommand('temcoTools.bacnet.openTrend', async (name?: unknown) => {
			const log = BACNET_TREND_LOGS.find((entry) => entry.name === String(name));
			if (!log) {
				return;
			}
			// The chart of one point belongs to I/O Studio, which owns the trend page: this opens that rather than
			// drawing a second, thinner chart here.
			await vscode.commands.executeCommand('temcoTools.io.trends');
			await vscode.window.showInformationMessage(
				`Temco BACnet: ${log.name} (${log.object}) opened as a trend. The series in I/O Studio is that controller’s own — a BACnet log is the same samples, read over the wire.`
			);
		}),

		// ---- Schedules
		vscode.commands.registerCommand('temcoTools.bacnet.newSchedule', async () => {
			const name = await vscode.window.showInputBox({
				title: 'New BACnet Schedule',
				prompt: 'A name for the schedule object',
				placeHolder: 'Night purge'
			});
			if (name === undefined || name.trim().length === 0) {
				return;
			}
			const next = BACNET_SCHEDULES.length + 1;
			BACNET_SCHEDULES.push({
				object: `SCH-${next}`,
				name: name.trim(),
				device: 'T3-BB · AHU-1',
				entries: 0,
				next: '—',
				state: 'Disabled',
				tone: 'neutral'
			});
			changed();
			await vscode.window.showInformationMessage(
				`Temco BACnet: SCH-${next} “${name.trim()}” created here, disabled and with no entries. The controller does not have it until a write reaches it.`
			);
		})
	];

	return { pages, disposables: commands };
}
