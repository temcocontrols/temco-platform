// The one read both surfaces draw from.
//
// The panel and the Overview page answer the same three questions — what is on the website, what is waiting, and where
// it goes — so they read one shape, once. Two readers of two shapes is how a panel and a page start disagreeing.

import { Build } from './builds';
import { ProjectArtifacts } from './artifacts';
import { Site } from './site';
import { RepoFacts } from './siteFacts';
import { PublishedState } from './state';

export interface Snapshot {
	site: Site;
	builds: Build[];
	/** What each project's last build wrote: the site, the help file, the pdf, the exports. */
	artifacts: ProjectArtifacts[];
	published: PublishedState;
	/**
	 * The clone behind all of it, when the caller asked for it.
	 *
	 * Optional because reading it costs a fetch: the panel and the tree only need the site, while the Overview says whether
	 * the repository has moved on since the last pull — and that is a question about the remote, not about the folder.
	 */
	repo?: RepoFacts;
}
