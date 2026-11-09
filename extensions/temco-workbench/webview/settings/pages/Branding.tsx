// Branding — the name and the accent this profile draws with.
//
// Two settings, and both are read where they land rather than recorded for a report: the name is what the welcome page and
// every studio line draw, and the accent is written into the window's own colour customizations. The colour roles are not
// settings at all — they are read from this frame's palette at runtime, so they are the theme's colours and not a sample.

import { Input } from '@fluentui/react-components';
import { useEffect, useState } from 'react';
import { ArrowSyncRegular, ColorRegular, StarRegular, TextFontRegular } from '@fluentui/react-icons';
import { Action, Entries, Entry, Hero, ICON, Page, Section } from '../chrome';
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

/** The palette a page of ours is drawn from, named the way the pages name it. */
const ROLE_TOKENS = [
	{ name: 'Accent', token: '--az-blue' },
	{ name: 'Text', token: '--ink-1' },
	{ name: 'Secondary', token: '--ink-2' },
	{ name: 'OK', token: '--ok-ink' },
	{ name: 'Warning', token: '--warn-ink' },
	{ name: 'Error', token: '--err-ink' }
];

interface Role {
	name: string;
	colour: string;
}

function readRoles(): Role[] {
	const style = getComputedStyle(document.body);
	return ROLE_TOKENS.map((role) => ({ name: role.name, colour: style.getPropertyValue(role.token).trim() }));
}

/**
 * The palette as the frame is drawing it.
 *
 * The variables are restated per theme on `body`, so the frame's class is the signal that they moved: a theme changed in
 * General repaints these swatches without a reload.
 */
function useRoles(): Role[] {
	const [roles, setRoles] = useState<Role[]>(readRoles);

	useEffect(() => {
		const update = (): void => setRoles(readRoles());
		update();
		const observer = new MutationObserver(update);
		observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-vscode-theme-kind'] });
		return () => observer.disconnect();
	}, []);

	return roles;
}

const ACCENT = /^#[0-9a-fA-F]{6}$/;

export function Branding({ state, ask }: Props): React.ReactElement {
	const set = (key: string, value: unknown): void => ask({ type: 'setting', key, value });
	const roles = useRoles();

	// The accent is typed, or picked, and only written when it is whole: a half-typed hex is not a colour.
	const [accent, setAccent] = useState(state.accent);
	useEffect(() => setAccent(state.accent), [state.accent]);
	const commit = (value: string): void => {
		if (ACCENT.test(value)) {
			if (value.toLowerCase() !== state.accent.toLowerCase()) {
				set('accent', value.toLowerCase());
			}
			return;
		}
		setAccent(state.accent);
	};

	return (
		<Page>
			<Hero
				title="Branding"
				mark={<ColorRegular fontSize={17} />}
				desc="The name this profile draws for itself, and the accent it draws it in. Both are read by the window rather than recorded for a report: the name is the welcome page's title and the studio line above every page of ours, and the accent is written into the workbench's own colours."
				note={<span className="az-note__text">{`${state.productName} · ${accent}`}</span>}
				actions={<Action label="Reset" glyph={<ArrowSyncRegular fontSize={ICON} />} onClick={() => ask({ type: 'command', command: 'temcoWorkbench.settings.resetBranding' })} />}
			/>

			<Section title="Identity" desc="Two settings, each read where it is drawn.">
				<Entries>
					<Entry
						glyph={<TextFontRegular fontSize={15} />}
						title="Product name"
						desc="Drawn on the welcome page and on the studio line above every page of ours."
						control={
							<Input
								className="setting-text"
								size="small"
								aria-label="Product name"
								defaultValue={state.productName}
								onBlur={(event) => {
									const value = event.target.value.trim();
									if (value.length > 0 && value !== state.productName) {
										set('productName', value);
									} else {
										event.target.value = state.productName;
									}
								}}
							/>
						}
					/>
					<Entry
						glyph={<ColorRegular fontSize={15} />}
						title="Accent colour"
						desc="Focus, primary buttons, badges, links and progress — written into the window's colour customizations."
						control={
							<>
								<input
									className="brand-swatch"
									type="color"
									aria-label="Accent colour"
									value={ACCENT.test(accent) ? accent.toLowerCase() : state.accent}
									onChange={(event) => setAccent(event.target.value)}
									onBlur={(event) => commit(event.target.value)}
								/>
								<Input
									className="setting-code"
									size="small"
									aria-label="Accent colour, six hex digits"
									value={accent}
									onChange={(_event, data) => setAccent(data.value)}
									onBlur={() => commit(accent)}
									onKeyDown={(event) => {
										if (event.key === 'Enter') {
											commit(accent);
										}
									}}
								/>
							</>
						}
					/>
				</Entries>
			</Section>

			<Section title="Colour Roles" desc="The palette every page of ours is drawn from, read from this window's theme — not a setting.">
				<div className="brand-palette">
					{roles.map((role) => (
						<div className="brand-palette__role" key={role.name}>
							<span className="brand-palette__chip" style={{ background: role.colour }} aria-hidden="true" />
							<span className="brand-palette__name">{role.name}</span>
							<code className="brand-palette__value">{role.colour}</code>
						</div>
					))}
				</div>
			</Section>

			<Section title="Application Mark" desc="The window, the taskbar and the title bar draw the same file at 64, 32 and 16 pixels.">
				<Entries>
					<Entry
						glyph={<StarRegular fontSize={15} />}
						title="Mark"
						desc="resources/temco-icon.svg — compiled into the build and drawn before any extension runs, so a profile cannot replace it."
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
		</Page>
	);
}
