// AI Runtime — the local model that answers, and the servers that run it.
//
// Only settings live here: the model and runtime the AI module reads, where its files are, what may be installed, and how
// long its two servers stay up. Choosing a model is a page, not a form, so the buttons that choose one leave for the AI
// page — this page records what that choice wrote.

import { Checkbox, Dropdown, Input, Option } from '@fluentui/react-components';
import { useEffect, useState } from 'react';
import {
	AppsListRegular,
	BrainCircuitRegular,
	ClockRegular,
	CodeRegular,
	FolderRegular,
	GlobeRegular,
	PanelRightRegular,
	ShieldLockRegular,
	WindowNewRegular
} from '@fluentui/react-icons';
import { Action, Entries, Entry, Hero, ICON, Page, Section } from '../chrome';
import { AiState, Ask } from '../state';

interface Props {
	state: AiState;
	ask: (message: Ask) => void;
}

/** The quiet spells the two idle rows offer, in the order a person meets them. Zero means "never stop". */
const IDLE = [
	{ value: 0, label: 'Never' },
	{ value: 5, label: '5 minutes' },
	{ value: 10, label: '10 minutes' },
	{ value: 30, label: '30 minutes' },
	{ value: 60, label: '1 hour' }
];

/** The list for a value that may have been written by hand, so the row shows it instead of drawing blank. */
function idles(value: number): { value: number; label: string }[] {
	return IDLE.some((option) => option.value === value) ? IDLE : [...IDLE, { value, label: `${String(value)} minutes` }];
}

function idleLabel(value: number): string {
	return IDLE.find((option) => option.value === value)?.label ?? (value > 0 ? `${String(value)} minutes` : 'Never');
}

/**
 * A whole number typed by hand.
 *
 * The value is committed on blur or Enter rather than on each keystroke: a port is written to settings.json, and a
 * half-typed `87` is not a port anyone meant.
 */
function NumberField(props: {
	label: string;
	value: number;
	min: number;
	max: number;
	onCommit: (value: number) => void;
}): React.ReactElement {
	const [text, setText] = useState(String(props.value));

	useEffect(() => setText(String(props.value)), [props.value]);

	const commit = (): void => {
		const parsed = Number(text);
		if (Number.isInteger(parsed) && parsed >= props.min && parsed <= props.max) {
			props.onCommit(parsed);
		} else {
			setText(String(props.value));
		}
	};

	return (
		<Input
			className="setting-number"
			size="small"
			type="number"
			aria-label={props.label}
			value={text}
			onChange={(_event, data) => setText(data.value)}
			onBlur={commit}
			onKeyDown={(event) => {
				if (event.key === 'Enter') {
					commit();
				}
			}}
		/>
	);
}

export function Ai({ state, ask }: Props): React.ReactElement {
	const set = (key: string, value: unknown): void => ask({ type: 'setting', key, value });
	const command = (name: string): void => ask({ type: 'command', command: name });

	const chosen = state.model.length > 0 && state.runtime.length > 0;
	const summary = chosen ? `${state.model} · ${state.runtime}` : state.model.length > 0 ? state.model : 'nothing chosen yet';
	const stops = state.idleMinutes > 0 ? `stops when idle for ${idleLabel(state.idleMinutes).toLowerCase()}` : 'stays loaded';

	return (
		<Page>
			<Hero
				title="AI Runtime"
				mark={<BrainCircuitRegular fontSize={17} />}
				desc="The local model that answers, and the servers that run it. Each row writes a temcoAi setting — the same key the AI module reads — so the module obeys what is recorded here; the model itself is chosen on the AI page."
				note={<span className="az-note__text">{`${summary} · ${stops}`}</span>}
				actions={
					<>
						<Action label="Choose Model" kind="primary" glyph={<AppsListRegular fontSize={ICON} />} onClick={() => command('temcoAi.page')} />
						<Action label="Open the AI Hub" glyph={<PanelRightRegular fontSize={ICON} />} onClick={() => command('workbench.view.extension.temcoAiHub')} />
					</>
				}
			/>

			<Section title="What Runs" desc="The pair the panel answers with, and where its files live — 3 settings.">
				<Entries>
					<Entry
						glyph={<BrainCircuitRegular fontSize={15} />}
						title="Model"
						desc={state.model.length > 0 ? `In use: ${state.model}.` : 'Nothing chosen yet — choose one on the AI page.'}
						control={<Action label="Choose…" kind="link" title="Choose a model on the AI page" onClick={() => command('temcoAi.page')} />}
					/>
					<Entry
						glyph={<CodeRegular fontSize={15} />}
						title="Runtime"
						desc={state.runtime.length > 0
							? `In use: ${state.runtime}. Chosen with the model, so the two cannot disagree.`
							: 'Nothing chosen yet. It is chosen with the model.'}
					/>
					<Entry
						glyph={<FolderRegular fontSize={15} />}
						title="Model folder"
						desc={state.folder.length > 0 ? state.folder : 'The profile’s own folder. Downloads and the server live here.'}
						control={<Action label="Open Folder" kind="link" title="Open the model folder" onClick={() => command('temcoAi.openModelFolder')} />}
					/>
				</Entries>
			</Section>

			<Section title="Downloads" desc="What the picker may install into that folder — 1 setting.">
				<Entries>
					<Entry
						glyph={<ShieldLockRegular fontSize={15} />}
						title="Allow unpinned models"
						desc="Install a file whose checksum the catalog does not pin. Off by default: an unverified download is refused."
						control={
							<Checkbox
								aria-label="Allow models the catalog does not pin"
								checked={state.allowUnpinned}
								onChange={(_event, data) => set('aiAllowUnpinned', data.checked)}
							/>
						}
					/>
				</Entries>
			</Section>

			<Section title="When It Stops" desc="How long the model server and the tool server stay up after the last question — 3 settings.">
				<Entries>
					<Entry
						glyph={<ClockRegular fontSize={15} />}
						title="Model server idle minutes"
						desc="The model server stops after this many quiet minutes, returning the memory it holds. Never keeps it loaded between questions."
						control={
							<Dropdown
								size="small"
								aria-label="Model server idle minutes"
								value={idleLabel(state.idleMinutes)}
								selectedOptions={[String(state.idleMinutes)]}
								onOptionSelect={(_event, data) => {
									if (data.optionValue !== undefined) {
										set('aiIdleMinutes', Number(data.optionValue));
									}
								}}
							>
								{idles(state.idleMinutes).map((option) => (
									<Option key={option.value} value={String(option.value)}>
										{option.label}
									</Option>
								))}
							</Dropdown>
						}
					/>
					<Entry
						glyph={<WindowNewRegular fontSize={15} />}
						title="Tool server port"
						desc="Where the tool server listens. 0 lets the window pick a free port each time it starts."
						control={<NumberField label="Tool server port" value={state.serverPort} min={0} max={65535} onCommit={(value) => set('aiServerPort', value)} />}
					/>
					<Entry
						glyph={<ClockRegular fontSize={15} />}
						title="Tool server idle minutes"
						desc="The tool server stops after this many quiet minutes. Never leaves it running between acts."
						control={
							<Dropdown
								size="small"
								aria-label="Tool server idle minutes"
								value={idleLabel(state.serverIdleMinutes)}
								selectedOptions={[String(state.serverIdleMinutes)]}
								onOptionSelect={(_event, data) => {
									if (data.optionValue !== undefined) {
										set('aiServerIdleMinutes', Number(data.optionValue));
									}
								}}
							>
								{idles(state.serverIdleMinutes).map((option) => (
									<Option key={option.value} value={String(option.value)}>
										{option.label}
									</Option>
								))}
							</Dropdown>
						}
					/>
				</Entries>
			</Section>

			<Section title="What It May Reach" desc="The service the tools call when an act needs one — 1 setting.">
				<Entries>
					<Entry
						glyph={<GlobeRegular fontSize={15} />}
						title="Platform API"
						desc={state.platformApi
							? 'Configured. Tools that need a service call use it.'
							: 'Not configured. Tools that need a service say so rather than failing quietly.'}
						control={<Action label="Configure" kind="link" title="Open the Platform API setting" onClick={() => command('temcoAi.configurePlatformApi')} />}
					/>
				</Entries>
			</Section>

		</Page>
	);
}
