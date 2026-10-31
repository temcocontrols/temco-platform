// What every Settings page is told, and what it says back.
//
// One bundle draws five pages, so the state says which one it is for and carries that page's facts. A page never reads a
// setting: the extension host reads the configuration and posts the state, and every control writes a key and waits for the
// next state. A page that made up a value would be a form whose checkboxes spring back.

export type Page = 'general' | 'modules' | 'branding' | 'ai' | 'publishing';

export type ThemeChoice = 'System' | 'Dark' | 'Light';
export type ChannelChoice = 'Stable' | 'Preview';

export interface GeneralState {
	theme: ThemeChoice;
	start: string;
	breadcrumbs: boolean;
	telemetry: boolean;
	channel: ChannelChoice;
	lastChanged: string;
	realSettings: number;
	totalSettings: number;
}

/** One module the platform loads, as the extension host reports it. */
export interface ModuleFact {
	name: string;
	id: string;
	namespace: string;
	owns: string;
	state: string;
	/** The command that opens the surface it draws, when it draws one. */
	open?: string;
}

export interface ModulesState {
	version: string;
	loaded: ModuleFact[];
	reserved: ModuleFact[];
}

export interface BrandingState {
	productName: string;
	accent: string;
	welcomePage: string;
	roles: { colour: string; name: string }[];
}

export interface AiState {
	chatModel: string;
	contextWindow: string;
	requireCitations: boolean;
	embeddingModel: string;
	drafts: string;
	offlineOnly: boolean;
}

export interface ArtifactFact {
	name: string;
	desc: string;
	on: boolean;
}

export interface PublishingState {
	channel: ChannelChoice;
	artifacts: ArtifactFact[];
	probe: string;
}

/** Everything the bundle can be told, in one message. Only the section matching `page` is set. */
export interface SettingsState {
	page: Page;
	general?: GeneralState;
	modules?: ModulesState;
	branding?: BrandingState;
	ai?: AiState;
	publishing?: PublishingState;
}

/** The startup views the manifest declares, in the order a person meets them. */
export const START_OPTIONS: { value: string; label: string }[] = [
	{ value: 'welcome', label: 'Welcome' },
	{ value: 'project', label: 'The project' },
	{ value: 'page', label: 'The last page' },
	{ value: 'home', label: 'Overview' },
	{ value: 'none', label: 'Nothing' }
];

/** What a page asks the host to do. Narrow on purpose: three kinds of message and no fourth. */
export type Ask =
	| { type: 'ready' }
	| { type: 'setting'; key: string; value: unknown; name?: string }
	| { type: 'command'; command: string };
