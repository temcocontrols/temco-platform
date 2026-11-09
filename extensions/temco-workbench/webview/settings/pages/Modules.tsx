// Modules — what this window loads, and what is only reserved.
//
// The cards come from the extension host, not from a table: a module is here because it is loaded, and its state is whether
// it has activated yet. What the sample adds is only what a manifest cannot say — the sentence naming what the module owns
// — and the host decides, by module id, which page each card's Open link opens.

import { ArrowSyncRegular, CubeRegular, FolderRegular } from '@fluentui/react-icons';
import { Action, Callout, Card, Cards, Facts, Hero, ICON, Page, Section } from '../chrome';
import { Ask, ModuleFact, ModulesState } from '../state';

interface Props {
	state: ModulesState;
	ask: (message: Ask) => void;
}

/**
 * The state a module is in, as a word and a dot: green once it has activated, amber while it is loaded but has not
 * activated yet, hollow when the build only reserves it.
 */
function ModuleState(props: { state: string }): React.ReactElement {
	const tone = props.state.toLowerCase();
	return <span className={`module-state module-state--${tone}`}>{props.state}</span>;
}

function ModuleCard(props: { module: ModuleFact; ask: (message: Ask) => void }): React.ReactElement {
	const module = props.module;
	return (
		<Card
			glyph={<CubeRegular fontSize={15} />}
			title={module.name}
			desc={module.owns}
			idle={module.state === 'Reserved'}
			meta={
				<>
					{module.namespace === '' ? null : <code className="module-namespace">{module.namespace}</code>}
					<ModuleState state={module.state} />
				</>
			}
			action={
				module.open === undefined ? undefined : (
					<Action
						label="Open"
						kind="link"
						title={`Open ${module.name}`}
						onClick={() => props.ask({ type: 'command', command: module.open as string })}
					/>
				)
			}
		/>
	);
}

export function Modules({ state, ask }: Props): React.ReactElement {
	const loaded = state.loaded.length;
	const reserved = state.reserved.length;

	return (
		<Page>
			<Hero
				title="Modules"
				mark={<CubeRegular fontSize={17} />}
				desc="A module is a built-in extension: it ships with the platform and is never installed, removed or updated from the window."
				note={<span className="az-note__text">{`${String(loaded)} loaded · ${String(reserved)} reserved · ${state.version}`}</span>}
				actions={
					<>
						<Action
							label="Check for Updates"
							kind="primary"
							glyph={<ArrowSyncRegular fontSize={ICON} />}
							onClick={() => ask({ type: 'command', command: 'temcoWorkbench.settings.checkUpdates' })}
						/>
						<Action label="Show on Disk" glyph={<FolderRegular fontSize={ICON} />} onClick={() => ask({ type: 'command', command: 'temcoWorkbench.settings.showOnDisk' })} />
					</>
				}
			/>

			<Callout
				tone="warn"
				title="There is no marketplace"
				desc="The build refuses a product.json that configures an extension gallery, so this window loads the modules in extensions/ and nothing else — there is nothing to install and nothing to update on its own."
			/>

			<Section
				title="Loaded"
				desc={`${String(loaded)} ${loaded === 1 ? 'module' : 'modules'}, read from the extension host: a module is here because it is loaded. Ids all live under the temcocontrols. scope, which the rows leave out.`}
			>
				<Cards>
					{state.loaded.map((module) => (
						<ModuleCard key={module.id} module={module} ask={ask} />
					))}
				</Cards>
			</Section>

			<Section
				title="Reserved"
				desc={
					reserved === 0
						? 'Every reserved module is loaded in this window.'
						: `${String(reserved)} modules with a folder and a surface drawn, but not loaded here: the build ships nothing for them until each has a first real feature.`
				}
			>
				{reserved === 0 ? null : (
					<Cards>
						{state.reserved.map((module) => (
							<ModuleCard key={module.id} module={module} ask={ask} />
						))}
					</Cards>
				)}
			</Section>

			<Section title="Platform Updates" desc="A module updates with the platform, never on its own — there is no optional module to add or remove.">
				<Facts
					items={[
						{ title: 'Version', value: state.version, mono: true },
						{ title: 'Channel', value: state.channel },
						{ title: 'Optional modules', value: 'none' }
					]}
				/>
			</Section>
		</Page>
	);
}
