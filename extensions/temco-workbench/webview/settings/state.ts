// What every Settings page is told, and what it says back.
//
// One bundle draws five pages, so the state says which one it is for and carries that page's facts. A page never reads a
// setting: the extension host reads the configuration and posts the state, and every control writes a key and waits for the
// next state. A page that made up a value would be a form whose checkboxes spring back.

export type Page = 'general' | 'modules' | 'branding' | 'ai' | 'publishing';

export type ChannelChoice = 'Stable' | 'Preview';

/** One entry a settings row offers: what is stored, and what a person reads. */
export interface Choice {
	value: string;
	label: string;
}

export interface GeneralState {
	theme: string;
	themes: Choice[];
	start: string;
	startOptions: Choice[];
	breadcrumbs: boolean;
	telemetry: boolean;
	channel: ChannelChoice;
	lastChanged: string;
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
	/** The channel a new version would come from, read from `temcoWorkbench.updateChannel`. */
	channel: ChannelChoice;
	loaded: ModuleFact[];
	reserved: ModuleFact[];
}

export interface BrandingState {
	productName: string;
	accent: string;
}

export interface AiState {
	/** `temcoAi.model` — the model the panel answers with, empty when nothing is chosen. */
	model: string;
	/** `temcoAi.runtime` — the server binary that runs it, set with the model by the module's picker. */
	runtime: string;
	/** `temcoAi.modelFolder` — where downloads and the server live, empty for the profile's own folder. */
	folder: string;
	allowUnpinned: boolean;
	/** `temcoAi.idleMinutes` — quiet minutes before the model server stops; 0 keeps it loaded. */
	idleMinutes: number;
	/** `temcoAi.serverPort` — where the tool server listens; 0 picks a free port. */
	serverPort: number;
	/** `temcoAi.serverIdleMinutes` — quiet minutes before the tool server stops; 0 keeps it running. */
	serverIdleMinutes: number;
	/** Whether `temcoAi.platformApi` names a service. The value itself is not sent to the page. */
	platformApi: boolean;
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

/** What a page asks the host to do. Narrow on purpose: three kinds of message and no fourth. */
export type Ask =
	| { type: 'ready' }
	| { type: 'setting'; key: string; value: unknown; name?: string }
	| { type: 'command'; command: string };
