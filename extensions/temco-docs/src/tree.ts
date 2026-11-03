// The Docs Explorer — the pages the registry holds, arranged the way a reader walks them.
//
// Rebuilt to the mock's content tree (`docs/mock/js/shell.js`, `renderDocTree`): an area is a folder, a chapter is
// a folder inside it, and a page is a leaf with its title and nothing else. A folder carries one number — how many
// pages are under it — because that is the only thing the panel adds to the names.
//
// What the mock does not have, and this panel keeps, is the state: a page's tooltip still says its id, owner,
// audience, provenance and last change, its icon is still tinted when the page has a problem, and a page with
// structural problems still folds out those problems as children. The difference is that a clean tree is now what
// a person sees first.

import * as vscode from 'vscode';
import { cutUris } from './clipboard';
import { Loose, LooseFile } from './loose';
import {
  AreaGroup,
  ChapterGroup,
  DocsRoot,
  PageEntry,
  Provenance,
  ROOT_CHAPTER,
  collectPages,
  contentUri,
  countStale,
} from './registry';

class FolderNode {
  readonly kind = 'folder';
  constructor(readonly root: DocsRoot) { }
}

class AreaNode {
  readonly kind = 'area';
  /**
   * True when this area is the view's own top level — with one repository open its areas are, and they open by
   * themselves so the pages are one click away instead of three. Anything deeper waits to be asked.
   */
  constructor(readonly root: DocsRoot, readonly area: AreaGroup, readonly top = false) { }
}

class ChapterNode {
  readonly kind = 'chapter';
  /**
   * A folder: one at the top of an area, or one inside another folder.
   *
   * `chapter.chapter` is the folder's own name, which is what its row shows; `segments` is where it sits under the
   * area, so `['getting-started', 'advanced']` is the folder `advanced` inside `getting-started`. A folder on disk
   * the registry does not name yet is shown the same way and renamed by a file move.
   */
  constructor(
    readonly root: DocsRoot,
    readonly area: AreaGroup,
    readonly chapter: ChapterGroup,
    readonly loose = false,
    readonly segments: string[] = chapter.chapter === ROOT_CHAPTER ? [] : [chapter.chapter]
  ) { }
}

/** One level of the tree below an area: the folders there, and the pages filed directly in it. */
interface FolderLevel {
  folders: Map<string, FolderLevel>;
  pages: PageEntry[];
  /** True when a folder on disk sits here and the registry does not name it — the row has to open for it. */
  loose: boolean;
}

class PageNode {
  readonly kind = 'page';
  constructor(readonly root: DocsRoot, readonly page: PageEntry, readonly loose = false) { }
}

class IssueNode {
  readonly kind = 'issue';
  constructor(readonly root: DocsRoot, readonly page: PageEntry, readonly index: number) { }
}

/**
 * A row that exists because there is nothing else to show: why the list is empty, and the one act that fills it.
 *
 * These are rows rather than a `viewsWelcome`, which was tried and dropped — a welcome's `when` clause is
 * resolved when the view is first painted, before the refresh has read anything, so it kept announcing "nothing
 * recorded yet" over a catalog that held five projects.
 */
export interface TreeNote {
  label: string;
  detail: string;
  command?: { command: string; args?: unknown[] };
}

class NoteNode {
  readonly kind = 'note';
  constructor(readonly note: TreeNote) { }
}

/** The project the tree shows: its first row, and the way to switch to another. */
export interface TreeProject {
  name: string;
  detail: string;
}

class ProjectNode {
  readonly kind = 'project';
  /**
   * The area this row stands in for, when it is the tree's root for a single-area project. It is what a page or a
   * folder dropped on the row moves into: with the area row gone, the project row *is* the area.
   */
  constructor(readonly project: TreeProject, readonly place?: { root: DocsRoot; area: AreaGroup }) { }
}

export type DocsNode =
  | ProjectNode
  | FolderNode
  | AreaNode
  | ChapterNode
  | PageNode
  | IssueNode
  | NoteNode;

export function pageFromNode(node: DocsNode | undefined): PageNode | undefined {
  return node?.kind === 'page' ? node : undefined;
}

export class DocsTreeProvider implements vscode.TreeDataProvider<DocsNode> {
  private readonly changed = new vscode.EventEmitter<DocsNode | undefined | void>();
  readonly onDidChangeTreeData = this.changed.event;

  private roots: DocsRoot[] = [];
  private notes: TreeNote[] = [];
  private project: TreeProject | undefined;
  /** Folders and files on disk the registry does not name, by root — filled by the module's own refresh. */
  private loose = new Map<string, Loose>();
  /** The folder shape of each area, built once per refresh from the page paths. */
  private levels = new Map<string, FolderLevel>();

  setProject(project: TreeProject | undefined): void {
    this.project = project;
  }

  /** Whether the tree draws the project as its own row — the case that makes a title description a repeat. */
  showsProjectRow(): boolean {
    return this.project !== undefined;
  }

  setRoots(roots: DocsRoot[], notes: TreeNote[] = [], loose: Map<string, Loose> = new Map()): void {
    // One place is one row. The module already reads each folder once, but this is the surface that paints, and a
    // caller that hands the same folder twice — two reads racing at startup, one path with a separator it lost —
    // must still draw one tree. That doubling is the whole of "the list is correct until something reloads".
    const seen = new Set<string>();
    this.roots = roots.filter((root) => {
      const key = root.folder.uri.toString().replace(/[\\/]+$/, '').toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
    this.notes = notes;
    this.loose = loose;
    this.levels.clear();
    this.changed.fire();
  }

  /**
   * The folders of one area, as a tree.
   *
   * A page id is its path under `docs/` without the extension, so `guides/getting-started/install` says that
   * `install` is filed in `getting-started`, inside `guides`. Every folder level is derived from those paths, which
   * is what lets a folder sit inside a folder without the registry having to name the middle one. Folders and files
   * found on disk but not registered yet are folded into the same shape.
   */
  private levelFor(root: DocsRoot, area: AreaGroup): FolderLevel {
    const key = `${root.folder.uri.toString()}|${area.area}`;
    const cached = this.levels.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const top: FolderLevel = { folders: new Map(), pages: [], loose: false };
    const descent = (segments: readonly string[]): FolderLevel => {
      let level = top;
      for (const segment of segments) {
        let next = level.folders.get(segment);
        if (next === undefined) {
          next = { folders: new Map(), pages: [], loose: false };
          level.folders.set(segment, next);
        }
        level = next;
      }
      return level;
    };

    for (const page of area.chapters.flatMap((group) => group.pages)) {
      const segments = page.id.split('/').slice(1, -1).filter((segment) => segment.length > 0 && segment !== ROOT_CHAPTER);
      descent(segments).pages.push(page);
    }
    const onDisk = this.loose.get(root.folder.uri.toString());
    for (const folder of onDisk?.folders ?? []) {
      if (folder.area !== area.area) {
        continue;
      }
      descent(folder.chapter.split('/').filter((segment) => segment.length > 0)).loose = true;
    }
    for (const file of onDisk?.files ?? []) {
      if (file.area !== area.area) {
        continue;
      }
      descent(file.chapter.split('/').filter((segment) => segment.length > 0))
        .pages.push(loosePage(area.area, file));
    }

    this.levels.set(key, top);
    return top;
  }

  /** The level a folder row stands for, or undefined when the folder is gone. */
  private levelAt(root: DocsRoot, area: AreaGroup, segments: readonly string[]): FolderLevel | undefined {
    let level: FolderLevel | undefined = this.levelFor(root, area);
    for (const segment of segments) {
      level = level.folders.get(segment);
      if (level === undefined) {
        return undefined;
      }
    }
    return level;
  }

  refresh(): void {
    this.changed.fire();
  }

  /**
   * The row for a place the module has just written — what lets *New folder* put the tree on the folder it made.
   *
   * A loose folder has no page yet, so it is not in the registry and not in any cached read: the node is built here
   * from the place alone, and the identity travels by the row's `id` (see `getTreeItem`), not by this object.
   */
  placeNode(rootUri: string, area: string, chapter: string): DocsNode | undefined {
    const root = this.roots.find((candidate) => candidate.folder.uri.toString() === rootUri);
    const group = root?.areas.find((candidate) => candidate.area === area);
    if (root === undefined || group === undefined) {
      return undefined;
    }
    const known = group.chapters.find((candidate) => candidate.chapter === chapter);
    const segments = chapter.split('/').filter((segment) => segment.length > 0);
    return known === undefined
      ? new ChapterNode(root, group, { chapter: segments[segments.length - 1] ?? chapter, pages: [] }, true, segments)
      : new ChapterNode(root, group, known, false, segments);
  }

  /**
   * The row a row sits under — what `reveal` walks, and it is a fold back up the same shape `getChildren` unfolds.
   *
   * Nothing is remembered between refreshes: every node carries its own place, so its parent can be rebuilt from it.
   */
  getParent(node: DocsNode): DocsNode | undefined {
    switch (node.kind) {
      case 'folder':
      case 'note':
      case 'project':
        return undefined;
      case 'area':
        return node.top ? undefined : new FolderNode(node.root);
      case 'chapter': {
        // A folder's parent is the folder above it, or the area when it sits at the top. Nothing is remembered
        // between refreshes: the row carries its own place, so its parent is rebuilt from its own segments.
        const above = node.segments.slice(0, -1);
        if (above.length === 0) {
          return this.topOf(node.root, node.area);
        }
        return new ChapterNode(
          node.root,
          node.area,
          { chapter: above[above.length - 1], pages: [] },
          false,
          above
        );
      }
      case 'page': {
        const area = node.root.areas.find((candidate) => candidate.area === node.page.area);
        if (area === undefined) {
          return new FolderNode(node.root);
        }
        const segments = node.page.id.split('/').slice(1, -1).filter((segment) => segment.length > 0);
        if (segments.length === 0) {
          return this.topOf(node.root, area);
        }
        const chapter = area.chapters.find((candidate) => candidate.chapter === segments[0]);
        return chapter === undefined
          ? new ChapterNode(node.root, area, { chapter: segments[segments.length - 1], pages: [] }, true, segments)
          : new ChapterNode(node.root, area, chapter, false, segments);
      }
      case 'issue':
        return new PageNode(node.root, node.page);
    }
  }

  /**
   * The row an area's top-level children hang under.
   *
   * With one source that has one area — the shape a new project has — the project's own row *is* that area: the
   * area row would repeat the project's name under the project's name. Every other shape keeps an area row, because
   * there the area says something the project row does not.
   */
  private topOf(root: DocsRoot, area: AreaGroup): DocsNode {
    const single = this.singleArea();
    if (single !== undefined && single.root.folder.uri.toString() === root.folder.uri.toString()) {
      return new ProjectNode(this.project ?? { name: '', detail: '' }, { root, area });
    }
    return new AreaNode(root, area, this.areasAreTop(root));
  }

  /** The one area a project row stands in for, when there is exactly one. */
  private singleArea(): { root: DocsRoot; area: AreaGroup } | undefined {
    if (this.project === undefined || this.roots.length !== 1) {
      return undefined;
    }
    const root = this.roots[0];
    return root.areas.length === 1 ? { root, area: root.areas[0] } : undefined;
  }

  /** Whether this root's areas are the view's own top level — the one case where an area has no folder above it. */
  private areasAreTop(root: DocsRoot): boolean {
    return this.roots.length === 1 && this.roots[0].folder.uri.toString() === root.folder.uri.toString();
  }

  getTreeItem(node: DocsNode): vscode.TreeItem {
    switch (node.kind) {
      case 'project': {
        const single = this.singleArea();
        // When the row stands for an area it can always be opened: an empty project opens onto the one row that
        // says so and offers New Page, which is more use than a row that refuses to expand.
        const item = new vscode.TreeItem(
          node.project.name,
          single === undefined ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Expanded
        );
        item.id = 'docs|project';
        // No count beside the name: a tree shows what exists, and the only number these rows carried was a total
        // nobody asked for. The tooltip still says it.
        // A folder, because that is what the row is: with one area it *is* that area, and the folder icon is what
        // says so. A book read as a different kind of row sitting among folders.
        item.iconPath = new vscode.ThemeIcon('folder');
        item.contextValue = 'project';
        item.tooltip = `${node.project.name}${node.project.detail ? ` · ${node.project.detail}` : ''} — click to switch project`;
        item.command = { command: 'temcoDocs.switchProject', title: 'Switch Project' };
        return item;
      }
      case 'folder':
        return folderItem(node);
      case 'area':
        return areaItem(node, this.levelFor(node.root, node.area).folders.size > 0);
      case 'chapter':
        return chapterItem(node, this.hasChildren(node));
      case 'page':
        return pageItem(node);
      case 'issue':
        return issueItem(node);
      case 'note': {
        const item = new vscode.TreeItem(node.note.label, vscode.TreeItemCollapsibleState.None);
        item.description = node.note.detail;
        item.tooltip = `${node.note.label} — ${node.note.detail}`;
        item.iconPath = new vscode.ThemeIcon(node.note.command ? 'arrow-right' : 'info');
        if (node.note.command) {
          item.command = {
            command: node.note.command.command,
            title: node.note.label,
            arguments: node.note.command.args ?? [],
          };
        }
        return item;
      }
    }
  }

  /** Whether a folder row has anything to open for: a folder inside it, a page filed in it, or a file on disk. */
  private hasChildren(node: ChapterNode): boolean {
    const level = this.levelAt(node.root, node.area, node.segments);
    return level !== undefined && (level.folders.size > 0 || level.pages.length > 0);
  }

  getChildren(node?: DocsNode): DocsNode[] {
    if (!node) {
      const roots = this.roots;
      // One source puts its areas at the top, the way the mock's tree starts at the areas. More than one keeps a
      // row per source: with two repositories open, a page named "Install" belongs to one of them. A single source
      // with no areas has nothing to lift — a repository read over the API that recorded no pages — so it keeps its
      // own row rather than leaving the view blank.
      const rows = roots.length === 0
        ? []
        : roots.length === 1 && roots[0].areas.length > 0
          ? roots[0].areas.map((area) => new AreaNode(roots[0], area, true))
          : roots.map((root) => new FolderNode(root));
      // Whatever the sources could not say for themselves: a source with no local copy, a registry that failed.
      // With one source and one area the project row *is* that area, so it also carries the area itself.
      const single = this.singleArea();
      const head = this.project === undefined
        ? []
        : [new ProjectNode(this.project, single === undefined ? undefined : { root: single.root, area: single.area })];
      // The areas are not drawn as well when the project row stands for the only one: the two rows carried the same
      // name and read as a duplicate. The project row's children are that area's rows.
      const body = single === undefined ? rows : [];
      return [...head, ...body, ...this.notes.map((note) => new NoteNode(note))];
    }

    switch (node.kind) {
      case 'project': {
        const single = this.singleArea();
        if (single === undefined) {
          return [];
        }
        const level = this.levelFor(single.root, single.area);
        const rows = this.rowsAt(single.root, [single.area], [], level);
        if (rows.length > 0) {
          return rows;
        }
        // An empty project is the ordinary state of a new one; the row that explains it also carries the one act.
        return [new NoteNode({
          label: 'No pages yet',
          detail: 'New Page writes the first one',
          command: { command: 'temcoDocs.newPage' },
        })];
      }
      case 'folder':
        return node.root.areas.map((area) => new AreaNode(node.root, area));
      case 'area': {
        const level = this.levelFor(node.root, node.area);
        return this.rowsAt(node.root, [node.area], [], level);
      }
      case 'chapter': {
        const level = this.levelAt(node.root, node.area, node.segments);
        return level === undefined ? [] : this.rowsAt(node.root, [node.area], node.segments, level);
      }
      case 'page':
        // No folded children: a page row is a file, and what is worth saying about it is said in the panel about it.
        return [];
      default:
        return [];
    }
  }

  /**
   * The rows one folder level holds: its folders first, in the order their first page has, then the pages filed
   * directly in it. A folder with nothing registered in it still gets a row when something is on disk there.
   */
  private rowsAt(
    root: DocsRoot,
    area: [AreaGroup],
    segments: readonly string[],
    level: FolderLevel
  ): DocsNode[] {
    const folders = [...level.folders].map(([name, child]) => ({
      name,
      child,
      segments: [...segments, name],
      order: child.pages.reduce((first, page) => Math.min(first, page.order), Number.MAX_SAFE_INTEGER),
    }));
    folders.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    return [
      ...folders.map((folder) => new ChapterNode(
        root,
        area[0],
        { chapter: folder.name, pages: folder.child.pages },
        folder.child.loose,
        folder.segments
      )),
      ...level.pages
        .slice()
        .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))
        .map((page) => new PageNode(root, page)),
    ];
  }
}

/** The page a loose file will be once the generator names it — the same id rule, and nothing claimed beyond it. */
function loosePage(area: string, file: LooseFile): PageEntry {
  const id = [area, file.chapter === ROOT_CHAPTER ? '' : file.chapter, file.name].filter((part) => part.length > 0).join('/');
  return {
    id,
    title: file.title,
    area,
    chapter: file.chapter,
    order: 0,
    audience: '',
    ship: true,
    owner: '',
    reviewed: null,
    tags: [],
    keywords: [],
    uri: file.uri,
    exists: true,
    issues: [],
  };
}

function folderItem(node: FolderNode): vscode.TreeItem {
  const item = new vscode.TreeItem(
    node.root.folder.name,
    node.root.areas.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None
  );
  const { root } = node;
  const recorded = root.origin === 'catalog';
  item.id = `docs|folder|${root.folder.uri.toString()}`;
  item.id = `docs|folder|${root.folder.uri.toString()}`;
  const stale = countStale(collectPages(root));
  item.tooltip = new vscode.MarkdownString(
    [
      `**${root.folder.name}**`,
      '',
      recorded
        ? `${root.pages} pages as the read recorded them. The checks need a folder on this machine, so none ` +
        'has been run on this source.'
        : `${root.pages} pages · ${root.issues} issues · ${root.neverReviewed} never reviewed` +
        (stale > 0 ? ` · ${stale} stale` : ''),
    ].join('\n')
  );
  item.iconPath = new vscode.ThemeIcon('folder');
  item.contextValue = recorded ? 'source' : 'folder';
  return item;
}

function areaItem(node: AreaNode, hasLoose = false): vscode.TreeItem {
  const { area } = node;
  const item = new vscode.TreeItem(
    area.title,
    area.chapters.length > 0 || hasLoose
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.None
  );
  item.id = `docs|area|${node.root.folder.uri.toString()}|${area.area}`;
  const stale = countStale(node.area.chapters.flatMap((chapter) => chapter.pages));
  item.tooltip = new vscode.MarkdownString(
    [
      `**${area.title}**`,
      '',
      [
        area.audience ? `audience: ${area.audience}` : '',
        area.noindex ? 'excluded from the published site' : '',
        `${area.pages} pages`,
        node.root.origin === 'catalog' ? '' : `${area.neverReviewed} never reviewed`,
        area.unshipped ? `${area.unshipped} not shipped` : '',
        stale > 0 ? `${stale} stale` : '',
      ]
        .filter(Boolean)
        .join(' · '),
    ].join('\n')
  );
  item.iconPath = new vscode.ThemeIcon('folder');
  item.contextValue = 'area';
  return item;
}

function chapterItem(node: ChapterNode, hasChildren = false): vscode.TreeItem {
  const item = new vscode.TreeItem(
    node.chapter.chapter,
    // Folders open by default: the tree is a list of pages, and a closed folder hides the very thing it is for.
    node.chapter.pages.length > 0 || hasChildren
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.None
  );
  // A folder's identity is its whole path: `advanced` inside `getting-started` is not the `advanced` beside it.
  item.id = `docs|chapter|${node.root.folder.uri.toString()}|${node.area.area}|${node.segments.join('/')}`;
  // One folder looks like one folder. A folder the registry does not name yet is still a folder, so it carries the
  // same icon as the registered ones and says nothing beside its name: "not registered" on every second row is a
  // wall of the same word, and the tooltip is where that belongs.
  item.iconPath = new vscode.ThemeIcon('folder');
  // A folder that was cut is on its way somewhere else, and Explorer's way of saying so is to dim it.
  if (cutUris().has(contentUri(node.root.rootUri, node.area.area, ...node.segments).toString())) {
    item.iconPath = new vscode.ThemeIcon('folder', new vscode.ThemeColor('disabledForeground'));
  }
  item.tooltip = node.loose
    ? 'A folder on disk that the registry does not name yet. Run the generator to register the pages inside it.'
    : undefined;
  item.contextValue = node.loose ? 'looseChapter' : 'chapter';
  // No click command: a folder row is opened and closed by clicking it, the way a folder in Explorer is. Renaming
  // is F2 and the context menu — a rename nobody asked for, on the gesture that means "show me what is inside",
  // is the wrong answer to the commonest click in the tree.
  return item;
}

function pageItem(node: PageNode): vscode.TreeItem {
  const { page } = node;
  const recorded = page.origin === 'catalog';
  // The row is a file, so it is named like one: `point-scaling.md`, not the curated title. A tree that shows titles
  // and a file manager that shows names disagree about every row, and the tree is the one people copy paths from.
  const file = `${page.id.split('/').pop() ?? page.id}.md`;
  const item = new vscode.TreeItem(file, vscode.TreeItemCollapsibleState.None);
  item.id = `docs|page|${node.root.folder.uri.toString()}|${page.id}`;
  // The name is the row. The curated title is not repeated beside it: it is in the tooltip and on the page itself, and a
  // row that says `test11.md TEST11` spends half the side bar's width saying the same thing twice.

  if (recorded) {
    // Nothing was checked and nothing was reviewed, so the row says what it is: a page a read told us about.
    item.tooltip = new vscode.MarkdownString(
      [
        `**${page.title}**`,
        '',
        `id: \`${page.id}\``,
        `owner: ${page.owner || '—'}`,
        '',
        `Read from ${node.root.folder.name}, which is not a folder on this machine — so the page's file, its ` +
        'headings, its staleness and its structural checks are all unknown. Reading a clone of the source is ' +
        'what makes them known.',
      ].join('\n')
    );
    item.iconPath = new vscode.ThemeIcon('cloud', new vscode.ThemeColor('descriptionForeground'));
    item.contextValue = 'catalogPage';
    return item;
  }

  item.tooltip = new vscode.MarkdownString(
    [
      `**${page.title}**`,
      '',
      `id: \`${page.id}\``,
      `owner: ${page.owner || '—'} · audience: ${page.audience}`,
      `ship: ${page.ship ? 'yes' : 'no'} · reviewed: ${page.reviewed ?? 'never'}`,
      ...provenanceLines(page.provenance),
    ].join('\n')
  );
  // The icon is the file's own: the row carries the file's URI, so the editor's file-icon theme draws the Markdown
  // icon and its colour — the same icon Explorer shows for the same file, rather than a generic page with a tint.
  item.resourceUri = page.uri;
  item.contextValue = node.loose ? 'loosePage' : page.exists ? 'page' : 'missingPage';
  if (node.loose) {
    item.tooltip = 'A page on disk that the registry does not name yet. Run the generator to register it.';
  }
  // A page that was cut is on its way somewhere else: Explorer dims it until it lands.
  if (cutUris().has(page.uri.toString())) {
    item.iconPath = new vscode.ThemeIcon('file', new vscode.ThemeColor('disabledForeground'));
  }
  item.command = {
    command: 'temcoDocs.openPage',
    title: 'Open Page',
    arguments: [node],
  };
  return item;
}

/** The lines a page tooltip adds once the generator's provenance is known — none when it is not. */
function provenanceLines(provenance: Provenance | undefined): string[] {
  if (!provenance) {
    return [];
  }
  const lines: string[] = [];
  const changed = provenance.updated ?? provenance.git?.date;
  if (changed) {
    const by = provenance.git?.author ? ` by ${provenance.git.author}` : '';
    const sha = provenance.git?.sha ? ` (${provenance.git.sha})` : '';
    lines.push(`last change: ${changed}${by}${sha}`);
  } else if (provenance.git?.sha) {
    lines.push(`last change: ${provenance.git.sha}`);
  }
  if (provenance.stale) {
    lines.push('**stale**: a commit touched code this page claims, after its last review');
  }
  const shown = provenance.headings.slice(0, 8);
  if (shown.length > 0) {
    const more = provenance.headings.length - shown.length;
    lines.push(`headings: ${shown.join(' · ')}${more > 0 ? ` · +${more} more` : ''}`);
  }
  return lines;
}

function issueItem(node: IssueNode): vscode.TreeItem {
  const issue = node.page.issues[node.index];
  const item = new vscode.TreeItem(issue.message, vscode.TreeItemCollapsibleState.None);
  item.id = `docs|issue|${node.root.folder.uri.toString()}|${node.page.id}|${node.index}`;
  item.iconPath = new vscode.ThemeIcon(
    issue.severity === 'error' ? 'error' : 'warning',
    new vscode.ThemeColor(issue.severity === 'error' ? 'problemsErrorIcon.foreground' : 'problemsWarningIcon.foreground')
  );
  item.contextValue = 'issue';
  return item;
}
