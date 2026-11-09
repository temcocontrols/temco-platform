// Publishing — where a release goes and what it is allowed to overwrite.
//
// Publishing never edits a page: it copies artifacts Build Center already built, so every row here is about a copy that
// already exists and the address it would be handed to.

import { Checkbox, Radio, RadioGroup } from '@fluentui/react-components';
import { CloudArrowUpRegular, DocumentRegular, GlobeRegular } from '@fluentui/react-icons';
import { Action, Callout, Entries, Entry, Facts, Hero, ICON, Page, Section } from '../chrome';
import { Ask, ChannelChoice, PublishingState } from '../state';

interface Props {
	state: PublishingState;
	ask: (message: Ask) => void;
}

export function Publishing({ state, ask }: Props): React.ReactElement {
	const set = (key: string, value: unknown, name?: string): void => ask({ type: 'setting', key, value, name });
	const on = state.artifacts.filter((artifact) => artifact.on).length;

	return (
		<Page>
			<Hero
				title="Publishing"
				mark={<CloudArrowUpRegular fontSize={17} />}
				desc="What a release takes with it and which channel it goes out on. Publishing never edits a page; it copies artifacts that Build Center already built, and the site's own address is Temco Learn's to set."
				note={<span className="az-note__text">{`${String(on)} of ${String(state.artifacts.length)} artifacts · ${state.channel.toLowerCase()} channel`}</span>}
				actions={
					<Action
						label="Test Connection"
						kind="primary"
						glyph={<GlobeRegular fontSize={ICON} />}
						onClick={() => ask({ type: 'command', command: 'temcoWorkbench.settings.testPublish' })}
					/>
				}
			/>

			<Callout
				tone="warn"
				title="A published version is frozen"
				desc="To change a page a reader can reach, publish a new version — an edit does not reach the site until it does."
			/>
			<Callout
				title="Test Connection sends nothing"
				desc="It checks this profile's own record of the target and nothing else: this build has no network client, so no request leaves the window."
			/>

			<Section title="Channel" desc="Where a release goes out — one setting, and it decides whether a search engine may see it.">
				<Entries>
					<Entry
						glyph={<DocumentRegular fontSize={15} />}
						title="Channel"
						desc="Preview publishes with noindex, so a search engine never sees a draft; Stable is the release readers get."
						control={
							<RadioGroup
								layout="horizontal"
								aria-label="Channel"
								value={state.channel}
								onChange={(_event, data) => set('publishChannel', data.value as ChannelChoice)}
							>
								<Radio value="Stable" label="Stable" />
								<Radio value="Preview" label="Preview" />
							</RadioGroup>
						}
					/>
				</Entries>
			</Section>

			<Section
				title="Artifacts"
				desc={`${String(on)} of ${String(state.artifacts.length)} are published. Each is built by Build Center; publishing copies what is already there.`}
			>
				<Entries>
					{state.artifacts.map((artifact) => (
						<Entry
							key={artifact.name}
							glyph={artifact.name === 'Website' ? <GlobeRegular fontSize={15} /> : <DocumentRegular fontSize={15} />}
							title={artifact.name}
							desc={artifact.desc}
							control={
								<Checkbox
									aria-label={`Publish ${artifact.name}`}
									checked={artifact.on}
									onChange={(_event, data) => set('artifact', data.checked, artifact.name)}
								/>
							}
						/>
					))}
				</Entries>
			</Section>

			<Section title="This Target" desc={`What Test Connection last read back: ${state.probe}.`}>
				<Facts
					items={[
						{ title: 'Channel', value: state.channel },
						{ title: 'Artifacts', value: `${String(on)} of ${String(state.artifacts.length)}` },
						{ title: 'Site', value: 'Temco Learn · Site', mono: true }
					]}
				/>
			</Section>
		</Page>
	);
}
