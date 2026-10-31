// Branding — the identity the shell draws: the mark, the wordmark and the accent.
//
// Two of the three rows are this profile's register and one is the editor's own colour theme, so the page says which is
// which: the mark is compiled into the build and cannot be replaced from inside it, and this page does not pretend to try.

import { Dropdown, Input, Option } from '@fluentui/react-components';
import { ArrowSyncRegular, ColorRegular, FolderOpenRegular, StarRegular, TextFontRegular } from '@fluentui/react-icons';
import { Action, Callout, Entries, Entry, Hero, ICON, Page, Section } from '../chrome';
import { Ask, BrandingState } from '../state';

interface Props {
	state: BrandingState;
	ask: (message: Ask) => void;
}

/** The application mark at one size: the same drawing, scaled. */
function Mark({ size, label }: { size: number; label: string }): React.ReactElement {
	return (
		<span
			className="brand-mark"
			style={{
				width: `${String(size)}px`,
				height: `${String(size)}px`,
				borderRadius: `${String(Math.round(size / 4.6))}px`,
				fontSize: `${String(Math.round(size / 2.5))}px`
			}}
			title={`${label} · ${String(size)} pixels`}
		>
			T
		</span>
	);
}

export function Branding({ state, ask }: Props): React.ReactElement {
	const set = (key: string, value: unknown): void => ask({ type: 'setting', key, value });

	return (
		<Page>
			<Hero
				title="Branding"
				mark={<ColorRegular fontSize={17} />}
				desc="The identity the shell draws: the mark, the wordmark and the accent. The rows show them in place rather than on a specimen sheet."
				note={<span className="az-note__text">{`${state.productName} · ${state.welcomePage === 'None' ? 'no welcome page' : `opens on ${state.welcomePage}`}`}</span>}
				actions={<Action label="Reset" glyph={<ArrowSyncRegular fontSize={ICON} />} onClick={() => ask({ type: 'command', command: 'temcoWorkbench.settings.resetBranding' })} />}
			/>

			<Section title="Application Mark" desc="The window, the taskbar and the title bar draw the same file at 64, 32 and 16 pixels.">
				<Entries>
					<Entry
						glyph={<StarRegular fontSize={15} />}
						title="Mark"
						desc="resources/temco-icon.svg — compiled into the build, drawn before any extension runs."
						control={
							<>
								<Mark size={40} label="Large" />
								<Mark size={26} label="Medium" />
								<Mark size={16} label="Small" />
								<Action label="Why not replaceable" kind="link" onClick={() => ask({ type: 'command', command: 'temcoWorkbench.settings.replaceIcon' })} />
							</>
						}
					/>
				</Entries>
			</Section>

			<Section title="Colour Roles" desc="A theme changes colour roles, never layout: every surface here is drawn from the five roles below. Which theme is worn is set in General.">
				<Entries>
					<Entry
						glyph={<ColorRegular fontSize={15} />}
						title="Colour roles"
						desc="Five roles draw every surface; a theme is a different set of them, not a different layout."
						control={
							<span className="brand-roles">
								{state.roles.map((role) => (
									<span className="brand-role" key={role.name}>
										<span className="brand-role__chip" style={{ background: role.colour }} />
										{role.name}
									</span>
								))}
							</span>
						}
					/>
				</Entries>
			</Section>

			<Section title="Identity" desc="Three settings this profile keeps: the name in the title bar, the accent, and the walkthrough a fresh profile opens.">
				<Entries>
					<Entry
						glyph={<TextFontRegular fontSize={15} />}
						title="Product name"
						desc="Drawn in the title bar and the About window."
						control={
							<Input
								size="small"
								aria-label="Product name"
								defaultValue={state.productName}
								onBlur={(event) => set('productName', event.target.value)}
							/>
						}
					/>
					<Entry
						glyph={<ColorRegular fontSize={15} />}
						title="Accent colour"
						desc="Used for focus, selection and the active container indicator. Six hex digits."
						control={
							<Input
								size="small"
								aria-label="Accent colour"
								defaultValue={state.accent}
								onBlur={(event) => set('accent', event.target.value)}
							/>
						}
					/>
					<Entry
						glyph={<FolderOpenRegular fontSize={15} />}
						title="Welcome page"
						desc="The walkthrough shown on a fresh profile."
						control={
							<Dropdown
								size="small"
								aria-label="Welcome page"
								value={state.welcomePage}
								selectedOptions={[state.welcomePage]}
								onOptionSelect={(_event, data) => {
									if (data.optionValue !== undefined) {
										set('welcomePage', data.optionValue);
									}
								}}
							>
								<Option value="Temco Platform">Temco Platform</Option>
								<Option value="None">None</Option>
							</Dropdown>
						}
					/>
				</Entries>
			</Section>

			<Callout
				title="The mark and the identity are this profile's register"
				desc="The window's icon is compiled into the build and cannot be replaced from inside it. The theme is not here: it is General's row, because it is the window's look rather than the product's identity."
			/>
		</Page>
	);
}
