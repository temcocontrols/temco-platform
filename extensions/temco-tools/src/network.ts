// Network — the four surfaces behind the container, rebuilt from the mock.
//
// Source: `docs/mock/js/views.industrial.js` (`network/discovery`, `network/modbus`, `network/diagnostics`,
// `network/captures`) and the mock's side bar, which splits them into **Tools** and **Traffic**
// (`docs/mock/js/data.js`).
//
// This is the studio that answers "who is on the wire" as opposed to "what does the controller say" — the hosts are
// read by address and vendor, the Modbus units by unit id, the captures by the filter that produced them. Nothing
// here claims a device fact the segment could not have told it.

import * as vscode from 'vscode';
import { HOSTS, MODBUS } from './data';
import {
	MODBUS_REGISTERS, NETWORK_CAPTURES, diagnosticsRun, latency, modbusEndpoint, modbusScan, recordDiagnosticsRun,
	recordModbusScan, recordSegmentScan, segmentRange, segmentScan
} from './networkSample';
import { PageMessage, commandScript, esc, icon, page, pageColumn, toneMark } from './ui';

/** One surface of the Network container: the row, the command, and the page it draws. */
export interface NetworkPage {
	id: string;
	label: string;
	note: string;
	mark: string;
	command: string;
	viewType: string;
	group: 'tools' | 'traffic';
}

export const NETWORK_PAGES: NetworkPage[] = [
	{ id: 'discovery', label: 'Discovery', note: 'every host the platform can see on the segment', mark: 'search', command: 'temcoTools.network.discovery', viewType: 'temcoTools.network.discovery', group: 'tools' },
	{ id: 'modbus', label: 'Modbus Scanner', note: 'unit ids and register ranges on the gateway', mark: 'list', command: 'temcoTools.network.modbus', viewType: 'temcoTools.network.modbus', group: 'tools' },
	{ id: 'diagnostics', label: 'Diagnostics', note: 'reachability, latency and packet loss', mark: 'activity', command: 'temcoTools.network.diagnostics', viewType: 'temcoTools.network.diagnostics', group: 'tools' },
	{ id: 'captures', label: 'Captures', note: 'packet captures, kept with the filter that made them', mark: 'download', command: 'temcoTools.network.captures', viewType: 'temcoTools.network.captures', group: 'traffic' }
];

/* ------------------------------------------------------------------ page vocabulary */

const button = (label: string, command: string, options: { kind?: 'primary' | 'ghost'; mark?: string; args?: unknown; small?: boolean } = {}): string =>
	`<button type="button" class="btn${options.small ? ' btn--sm' : ''}${options.kind ? ` btn--${options.kind}` : ''}" data-command="${command}"${options.args === undefined ? '' : ` data-args="${esc(JSON.stringify(options.args))}"`}>${options.mark ? icon(options.mark) : ''}<span>${esc(label)}</span></button>`;

const badge = (text: string, tone?: string): string =>
	`<span class="badge${tone && tone !== 'neutral' ? ` badge--${tone}` : ''}">${esc(text)}</span>`;

const pageHead = (options: { title: string; mark: string; desc: string; actions: string }): string =>
	`<div class="page-head"><div class="page-head__main"><h1 class="page-head__title">${icon(options.mark)}${esc(options.title)}</h1><p class="page-head__desc">${esc(options.desc)}</p></div><div class="page-head__actions">${options.actions}</div></div>`;

const rule = (options: { label: string; count?: string; actions?: string }): string =>
	`<div class="group-head"><span class="group-head__label">${esc(options.label)}</span><span class="group-head__rule"></span>${options.count ? `<span class="group-head__count">${esc(options.count)}</span>` : ''}${options.actions ? `<span class="group-head__actions">${options.actions}</span>` : ''}</div>`;

const group = (options: { label: string; count?: string; note?: string; body: string }): string =>
	`${rule(options)}${options.note ? `<p class="group-note">${esc(options.note)}</p>` : ''}<div class="record-list">${options.body}</div>`;

const tiles = (items: { value: string; label: string }[]): string =>
	`<div class="tiles">${items.map((item) => `<div class="tile"><span class="tile__value">${esc(item.value)}</span><span class="tile__label">${esc(item.label)}</span></div>`).join('')}</div>`;

const callout = (html: string, kind: 'warn' | 'ok' | 'info' = 'info'): string =>
	`<div class="callout${kind === 'info' ? '' : ` callout--${kind}`}">${icon(kind === 'warn' ? 'alert' : kind === 'ok' ? 'check' : 'info')}<div>${html}</div></div>`;

const n = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/* ------------------------------------------------------------------ the four pages */

/** *Discovery* — the mock's `network/discovery`. */
function discoveryBody(): string {
	const answering = HOSTS.filter((host) => host.state === 'Online');
	const foreign = HOSTS.filter((host) => host.vendor !== 'Temco');
	const silent = HOSTS.filter((host) => host.protocol === '—');

	return `${pageHead({
		title: 'Network Discovery',
		mark: 'globe',
		desc: 'Every host the platform can see on the local segment, whatever protocol it speaks. A host that answers ARP is not necessarily a device: a workstation shows up here too.',
		actions: button('Scan Segment', 'temcoTools.network.scan', { kind: 'primary', mark: 'search' })
	})}
<div class="toolbar">
	<input class="input" value="${esc(segmentRange)}" aria-label="Range" readonly>
	${button('ARP Lookup', 'temcoTools.network.arpLookup', { small: true, mark: 'search' })}
	<span class="toolbar__spacer"></span>
	<span class="cell-muted" style="font-size:12px">${n(HOSTS.length, 'host', 'hosts')} · ${n(HOSTS.length - answering.length, 'unreachable', 'unreachable')} · ${esc(segmentScan)}</span>
</div>
<div class="mt-16">${tiles([
		{ value: String(HOSTS.length), label: 'Hosts' },
		{ value: String(answering.length), label: 'Answering' },
		{ value: String(foreign.length), label: 'Not Temco' },
		{ value: String(silent.length), label: 'No protocol' }
	])}</div>
<div class="mt-24">${group({
		label: 'Hosts',
		count: n(HOSTS.length, 'address', 'addresses'),
		note: 'The vendor comes from the MAC prefix, so it is a guess about the hardware and not a claim about the device.',
		body: HOSTS.map((host) => `<div class="record-row">
	${toneMark('server', host.tone)}
	<div class="record-row__main">
		<div class="record-row__title"><span class="record-row__name">${esc(host.name)}</span><span class="tag">${esc(host.protocol)}</span>${host.vendor !== 'Temco' ? badge('Third-party', 'neutral') : ''}</div>
		<div class="record-row__meta"><span class="cell-mono">${esc(host.ip)}</span><span class="cell-mono">${esc(host.mac)}</span><span>${esc(host.vendor)}</span></div>
	</div>
	<div class="record-row__state">${badge(host.state, host.tone)}</div>
	<div class="record-row__state"></div>
</div>`).join('')
	})}</div>
<div class="mt-16">${callout('Scan Segment re-walks this build’s host register. There is no ARP table behind it, so a host that is not in the register cannot be found by scanning.')}</div>`;
}

/** *Modbus Scanner* — the mock's `network/modbus`. */
function modbusBody(): string {
	const units = [...new Set(MODBUS_REGISTERS.map((register) => register.unit))];

	return `${pageHead({
		title: 'Modbus Scanner',
		mark: 'list',
		desc: 'Unit ids and register ranges on the Modbus side of the gateway. Reading a register is safe; writing one is a device command, and a write to a timed-out unit fails silently on the wire.',
		actions: button('Scan Units', 'temcoTools.network.scanUnits', { kind: 'primary', mark: 'search' })
	})}
<div class="toolbar">
	<input class="input" value="${esc(modbusEndpoint)}" aria-label="Endpoint" readonly>
	<select class="select" aria-label="Register type"><option>Holding registers</option><option>Input registers</option><option>Coils</option></select>
	<span class="toolbar__spacer"></span>
	<span class="cell-muted" style="font-size:12px">units 1–247 · ${n(units.length, 'unit answered', 'units answered')} · ${esc(modbusScan)}</span>
</div>
<div class="mt-24">${group({
		label: 'Registers',
		count: n(MODBUS_REGISTERS.length, 'register', 'registers'),
		note: `Unit ids 1, 2 and 7 are the ones the gateway reported; ${n(MODBUS.length, 'unit row is', 'unit rows are')} in the register.`,
		body: MODBUS_REGISTERS.map((register) => `<div class="record-row">
	${toneMark('server', register.tone)}
	<div class="record-row__main">
		<div class="record-row__title"><span class="record-row__name cell-mono">${esc(register.register)}</span><span>${esc(register.name)}</span><span class="tag">unit ${register.unit}</span></div>
		<div class="record-row__meta"><span>${esc(register.type)}</span>${register.state === 'Timeout' ? '<span>no answer — unit 2 is on the MS/TP trunk</span>' : '<span>scaled as ×10</span>'}</div>
	</div>
	<div class="record-row__state cell-mono cell-strong">${esc(register.value)}</div>
	<div class="record-row__state">${badge(register.state, register.tone)}</div>
</div>`).join('')
	})}</div>
<div class="mt-16">${callout('Scan Units re-probes the units in the register: it cannot discover a unit id the gateway does not already answer for.')}</div>`;
}

/** *Diagnostics* — the mock's `network/diagnostics`. */
function diagnosticsBody(): string {
	const answering = HOSTS.filter((host) => host.state === 'Online');
	const down = HOSTS.filter((host) => host.state !== 'Online');
	const worst = down[0];
	const address = worst ? worst.ip : '192.168.10.31';
	const ping = [
		`Pinging ${address} with 32 bytes of data:`,
		'Request timed out.',
		'Request timed out.',
		'Request timed out.',
		'Request timed out.',
		'',
		`Ping statistics for ${address}:`,
		'    Packets: Sent = 4, Received = 0, Lost = 4 (100% loss),'
	].join('\n');

	return `${pageHead({
		title: 'Diagnostics',
		mark: 'activity',
		desc: 'Reachability, latency and packet loss for the hosts the workspace depends on. A ping that times out is the start of a diagnosis, not the diagnosis.',
		actions: button('Run All', 'temcoTools.network.runDiagnostics', { kind: 'primary', mark: 'play' })
	})}
<div class="mt-16">${tiles([
		{ value: `${answering.length} of ${HOSTS.length}`, label: 'Hosts answering' },
		{ value: String(down.length), label: 'Timeouts' },
		{ value: '4 ms', label: 'Median latency' },
		{ value: '0.2 %', label: 'Packet loss' }
	])}</div>
<div class="mt-24">
	${rule({ label: `Ping · ${address}`, count: worst ? '4 of 4 lost' : 'no failures', actions: button('Copy Report', 'temcoTools.network.copyReport', { small: true, kind: 'ghost' }) })}
	<div class="mt-16"><pre class="code">${esc(ping)}</pre></div>
	<p class="group-note">${esc(diagnosticsRun)}</p>
</div>
<div class="mt-24">${group({
		label: 'Hosts',
		count: n(HOSTS.length, 'host', 'hosts'),
		note: 'A controller that answers ping but not BACnet is a different problem from one that answers neither.',
		body: HOSTS.map((host) => `<div class="record-row record-row--static">
	${toneMark('server', host.tone)}
	<div class="record-row__main">
		<div class="record-row__title"><span class="record-row__name cell-mono">${esc(host.ip)}</span><span>${esc(host.name)}</span></div>
		<div class="record-row__meta"><span>${esc(host.protocol)}</span><span>${esc(host.vendor)}</span></div>
	</div>
	<div class="record-row__state cell-mono cell-muted">${esc(latency(host.state))}</div>
	<div class="record-row__state">${badge(host.state === 'Online' ? 'Answered' : 'Timed out', host.tone)}</div>
</div>`).join('')
	})}</div>`;
}

/** *Captures* — the mock's `network/captures`. */
function capturesBody(): string {
	return `${pageHead({
		title: 'Captures',
		mark: 'download',
		desc: 'Packet captures taken from this machine or a mirrored port, kept with the filter that produced them — a capture without its filter is a file nobody can repeat.',
		actions: button('New Capture', 'temcoTools.network.newCapture', { kind: 'primary', mark: 'plus' })
	})}
${group({
		label: 'Captures',
		count: n(NETWORK_CAPTURES.length, 'capture', 'captures'),
		body: NETWORK_CAPTURES.map((capture, index) => `<div class="record-row">
	${toneMark(capture.state === 'Recording' ? 'activity' : 'download', capture.tone === 'neutral' ? undefined : capture.tone)}
	<div class="record-row__main">
		<div class="record-row__title"><span class="record-row__name cell-mono">${esc(capture.name)}</span></div>
		<div class="record-row__meta"><span>${esc(capture.detail)}</span></div>
	</div>
	<div class="record-row__state">${badge(capture.state, capture.tone)}</div>
	${capture.state === 'Recording'
				? button('Stop', 'temcoTools.network.stopCapture', { small: true, args: [index] })
				: button('Open', 'temcoTools.network.openCapture', { small: true, kind: 'ghost', args: [index] })}
</div>`).join('')
	})}
<div class="mt-16">${callout('A capture is written to the workspace folder and is never committed. Deleting the row deletes the file.')}</div>
<div class="mt-16">${callout('There is no capture device in this build: these rows are the register’s, and Stop closes a row rather than a file.')}</div>`;
}

const BODIES: { [id: string]: () => string } = {
	discovery: discoveryBody,
	modbus: modbusBody,
	diagnostics: diagnosticsBody,
	captures: capturesBody
};

/** The four pages, one panel each, kept open so a second visit reveals the tab rather than stacking another. */
export class NetworkPages {
	private readonly panels = new Map<string, vscode.WebviewPanel>();

	constructor(private readonly context: vscode.ExtensionContext) { }

	open(id: string, restored?: vscode.WebviewPanel): void {
		const definition = NETWORK_PAGES.find((entry) => entry.id === id);
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
		panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'network.svg');
		panel.webview.html = this.document(definition, body);
		panel.webview.onDidReceiveMessage((message: PageMessage) => {
			if (message.type !== 'command' || typeof message.command !== 'string') {
				return;
			}
			// `data-args` arrives as one array; a command wants them spread.
			const args = Array.isArray(message.args) ? message.args : message.args === undefined ? [] : [message.args];
			void vscode.commands.executeCommand(message.command, ...args);
		});
		this.panels.set(id, panel);
		panel.onDidDispose(() => this.panels.delete(id));
	}

	refresh(): void {
		for (const [id, panel] of this.panels) {
			const definition = NETWORK_PAGES.find((entry) => entry.id === id);
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

	private document(definition: NetworkPage, body: () => string): string {
		return page(body(), { title: definition.label, script: commandScript });
	}
}

/* ------------------------------------------------------------------ what a button does */

/** The ping block the Copy Report button puts on the clipboard — the same text the page shows. */
function report(): string {
	const down = HOSTS.filter((host) => host.state !== 'Online');
	const address = down[0] ? down[0].ip : '192.168.10.31';
	return [
		`# Temco Network · ${diagnosticsRun}`,
		`# Segment ${segmentRange} · ${n(HOSTS.length, 'host', 'hosts')}, ${HOSTS.filter((host) => host.state === 'Online').length} answering`,
		'',
		`Pinging ${address} with 32 bytes of data:`,
		'Request timed out.',
		'Request timed out.',
		'Request timed out.',
		'Request timed out.',
		'',
		`Ping statistics for ${address}:`,
		'    Packets: Sent = 4, Received = 0, Lost = 4 (100% loss),'
	].join('\n');
}

export function registerNetwork(context: vscode.ExtensionContext): { pages: NetworkPages; disposables: vscode.Disposable[] } {
	const pages = new NetworkPages(context);
	const changed = (): void => pages.refresh();

	const commands: vscode.Disposable[] = [
		...NETWORK_PAGES.map((definition) => vscode.commands.registerCommand(definition.command, () => pages.open(definition.id))),

		// ---- Discovery
		vscode.commands.registerCommand('temcoTools.network.scan', async () => {
			recordSegmentScan(segmentRange);
			changed();
			const answering = HOSTS.filter((host) => host.state === 'Online');
			await vscode.window.showInformationMessage(
				`Temco Network: ${n(HOSTS.length, 'host', 'hosts')} on ${segmentRange}, ${answering.length} answering. The scan re-walked this build’s register; no ARP request went out.`
			);
		}),

		vscode.commands.registerCommand('temcoTools.network.arpLookup', async () => {
			const address = await vscode.window.showInputBox({
				title: 'ARP Lookup',
				prompt: 'An address on this segment',
				placeHolder: '192.168.10.21'
			});
			if (address === undefined || address.trim().length === 0) {
				return;
			}
			const host = HOSTS.find((entry) => entry.ip === address.trim());
			if (!host) {
				await vscode.window.showWarningMessage(
					`Temco Network: ${address.trim()} is not in the register. With no ARP table in this build, the lookup cannot say whether anything owns that address.`
				);
				return;
			}
			await vscode.window.showInformationMessage(`Temco Network: ${host.ip}`, {
				detail: [
					`MAC ${host.mac} · vendor ${host.vendor} (from the MAC prefix)`,
					`Name ${host.name} · protocol ${host.protocol} · ${host.state}`
				].join('\n')
			});
		}),

		// ---- Modbus Scanner
		vscode.commands.registerCommand('temcoTools.network.scanUnits', async () => {
			recordModbusScan(modbusEndpoint);
			changed();
			const answered = [...new Set(MODBUS_REGISTERS.filter((register) => register.state === 'OK').map((register) => register.unit))];
			const timedOut = [...new Set(MODBUS_REGISTERS.filter((register) => register.state === 'Timeout').map((register) => register.unit))];
			await vscode.window.showInformationMessage(
				`Temco Network: units ${answered.join(', ')} answered on ${modbusEndpoint}` +
				(timedOut.length ? `; unit ${timedOut.join(', ')} timed out — nothing on the trunk replied.` : '.')
			);
		}),

		// ---- Diagnostics
		vscode.commands.registerCommand('temcoTools.network.runDiagnostics', async () => {
			recordDiagnosticsRun();
			changed();
			const answering = HOSTS.filter((host) => host.state === 'Online').length;
			await vscode.window.showInformationMessage(
				`Temco Network: ${answering} of ${HOSTS.length} hosts answering, 4 ms median, 0.2 % loss. These are the register’s measurements; this build sends no packets.`
			);
		}),

		vscode.commands.registerCommand('temcoTools.network.copyReport', async () => {
			await vscode.env.clipboard.writeText(report());
			await vscode.window.showInformationMessage('Temco Network: the report is on the clipboard, with the ping block and the segment it ran against.');
		}),

		// ---- Captures
		vscode.commands.registerCommand('temcoTools.network.newCapture', async () => {
			const filter = await vscode.window.showInputBox({
				title: 'New Capture',
				prompt: 'The filter the capture runs with, in capture syntax',
				value: 'not port 3389',
				placeHolder: 'udp port 47808'
			});
			if (filter === undefined || filter.trim().length === 0) {
				return;
			}
			const index = NETWORK_CAPTURES.length;
			NETWORK_CAPTURES.push({
				name: `Live capture · ${index + 1}`,
				detail: `recording · 0 packets · filter "${filter.trim()}"`,
				state: 'Recording',
				tone: 'info',
				filter: filter.trim()
			});
			changed();
			await vscode.window.showInformationMessage(
				`Temco Network: capture ${index + 1} opened with "${filter.trim()}". It is a row in this build — nothing is written to disk.`
			);
		}),

		vscode.commands.registerCommand('temcoTools.network.stopCapture', async (index?: unknown) => {
			const capture = NETWORK_CAPTURES[Number(index)];
			if (!capture || capture.state !== 'Recording') {
				return;
			}
			capture.state = 'Closed';
			capture.tone = 'neutral';
			capture.detail = capture.detail.replace('recording', 'stopped');
			changed();
			await vscode.window.showInformationMessage(
				`Temco Network: “${capture.name}” closed with "${capture.filter}". A capture is only repeatable if the filter travels with it.`
			);
		}),

		vscode.commands.registerCommand('temcoTools.network.openCapture', async (index?: unknown) => {
			const capture = NETWORK_CAPTURES[Number(index)];
			if (!capture) {
				return;
			}
			await vscode.window.showInformationMessage(`Temco Network: “${capture.name}”`, {
				detail: [
					capture.detail,
					`Filter ${capture.filter}`,
					'Opening a .pcapng needs a capture tool, and this build holds no files — the row is the register’s.'
				].join('\n')
			});
		})
	];

	return { pages, disposables: commands };
}
