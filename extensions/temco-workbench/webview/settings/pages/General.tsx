// General — the window's own settings.
//
// Five rows, and each one is a setting this build declares: a control asks the host to write a key and then draws whatever
// state comes back, so nothing here can claim a change it did not make. Both lists — the themes and the left panel's items
// — arrive in the state rather than being written here, because what this build ships is the host's fact, not the page's.

import { Checkbox, Dropdown, Option, Radio, RadioGroup } from '@fluentui/react-components';
import {
	ArrowDownloadRegular,
	ArrowSyncRegular,
	ClockRegular,
	CodeRegular,
	InfoRegular,
	NavigationRegular,
	PaintBrushRegular,
	SettingsRegular,
	WindowNewRegular
} from '@fluentui/react-icons';
import { Action, Callout, Entries, Entry, Facts, Hero, ICON, Page, Section } from '../chrome';
import { Ask, ChannelChoice, Choice, GeneralState } from '../state';

interface Props {
	state: GeneralState;
	ask: (message: Ask) => void;
}

/** The label of the chosen entry, falling back to the stored value so a row never draws blank. */
function labelOf(options: readonly Choice[], value: string): string {
	return options.find((option) => option.value === value)?.label ?? value;
}

export function General({ state, ask }: Props): React.ReactElement {
	const set = (key: string, value: unknown): void => ask({ type: 'setting', key, value });

	const openJson = (): void => ask({ type: 'command', command: 'workbench.action.openSettingsJson' });
	const restore = (): void => ask({ type: 'command', command: 'temcoWorkbench.settings.reset' });
	const themeLabel = labelOf(state.themes ?? [], state.theme);
	const startLabel = labelOf(state.startOptions ?? [], state.start);

	return (
		<Page>
			<Hero
				title="General"
				mark={<SettingsRegular fontSize={17} />}
				desc="How the window looks, what it opens with, what it reports, and where a new version comes from. Each of these five rows is one setting in this profile's settings.json — the window obeys it at once, and the value is still there after a restart. Where work is kept is Repositories' business, and the identity is Branding's."
				note={
					<>
						<span className="az-note__mark">
							<ClockRegular fontSize={13} />
						</span>
						<span className="az-note__text">Last changed {state.lastChanged}</span>
					</>
				}
				actions={
					<>
						<Action label="Open settings.json" kind="primary" glyph={<CodeRegular fontSize={ICON} />} onClick={openJson} />
						<Action label="Restore Defaults" glyph={<ArrowSyncRegular fontSize={ICON} />} onClick={restore} />
					</>
				}
			/>

			<Callout
				title="Five rows, five settings"
				desc="Theme and Startup view choose from what this build declares; Breadcrumbs, Telemetry and the update channel write the window's own keys. Restore Defaults removes the values rather than copying them, so each row falls back to the default its manifest states."
			/>

			<Section title="Window" desc="What the window looks like, and what it opens with — 3 settings.">
				<Entries>
					<Entry
						glyph={<PaintBrushRegular fontSize={15} />}
						title="Theme"
						desc="Colour roles only — a theme never changes the layout. Dark, light and high-contrast themes all ship with this build."
						control={
							<Dropdown
								size="small"
								aria-label="Theme"
								value={themeLabel}
								selectedOptions={[state.theme]}
								onOptionSelect={(_event, data) => {
									if (data.optionValue !== undefined) {
										set('theme', data.optionValue);
									}
								}}
							>
								{(state.themes ?? []).map((theme) => (
									<Option key={theme.value} value={theme.value}>
										{theme.label}
									</Option>
								))}
							</Dropdown>
						}
					/>
					<Entry
						glyph={<WindowNewRegular fontSize={15} />}
						title="Startup view"
						desc="The side panel the window opens with — the same items the left panel carries."
						control={
							<Dropdown
								size="small"
								aria-label="Startup view"
								value={startLabel}
								selectedOptions={[state.start]}
								onOptionSelect={(_event, data) => {
									if (data.optionValue !== undefined) {
										set('start', data.optionValue);
									}
								}}
							>
								{(state.startOptions ?? []).map((option) => (
									<Option key={option.value} value={option.value}>
										{option.label}
									</Option>
								))}
							</Dropdown>
						}
					/>
					<Entry
						glyph={<NavigationRegular fontSize={15} />}
						title="Breadcrumbs"
						desc="The path above the editor, and the line above a page's title — every page the platform draws respects it. On by default."
						control={
							<Checkbox
								aria-label="Show breadcrumbs"
								checked={state.breadcrumbs}
								onChange={(_event, data) => set('breadcrumbs', data.checked)}
							/>
						}
					/>
				</Entries>
			</Section>

			<Section title="Diagnostics and Updates" desc="What leaves this machine, and which channel a new version comes from.">
				<Entries>
					<Entry
						glyph={<InfoRegular fontSize={15} />}
						title="Telemetry"
						desc="Documentation checks and build failures only. Never page content, never a prompt."
						control={<Checkbox aria-label="Send diagnostics" checked={state.telemetry} onChange={(_event, data) => set('telemetry', data.checked)} />}
					/>
					<Entry
						glyph={<ArrowDownloadRegular fontSize={15} />}
						title="Update channel"
						desc="Preview adds release candidates one version earlier than Stable. A change takes effect on restart."
						control={
							<RadioGroup
								layout="horizontal"
								aria-label="Update channel"
								value={state.channel}
								onChange={(_event, data) => set('updateChannel', data.value as ChannelChoice)}
							>
								<Radio value="Stable" label="Stable" />
								<Radio value="Preview" label="Preview" />
							</RadioGroup>
						}
					/>
				</Entries>
			</Section>

			<Section
				title="Where These Live"
				desc="The file these five rows are written to, and when each takes effect."
			>
				<Facts
					items={[
						{ title: 'File', value: 'settings.json · this profile', mono: true },
						{ title: 'Keys', value: 'workbench · telemetry · temcoWorkbench', mono: true },
						{ title: 'Applied', value: 'at once · channel on restart' },
						{ title: 'Last changed', value: state.lastChanged }
					]}
				/>
			</Section>
		</Page>
	);
}
