/**
 * Lazy, batch-rendered JSON tree used by the panel.
 *
 * Children are created on demand (on expand) and DOM rows are appended in
 * requestAnimationFrame batches, so documents with hundreds of thousands of
 * nodes stay responsive. Filtering computes matching node ids in one pass and
 * auto-expands their ancestors.
 *
 * Deliberately framework-free (plain DOM) so Vue reactivity never touches
 * per-node state; the Vue component (TreeView.vue) is a thin host around it.
 */

const SEP = '\x1F'; // path separator for node ids (keys may contain dots)

function isContainer(value: unknown): boolean {
  return value !== null && typeof value === 'object';
}

function summaryText(value: object): string {
  if (Array.isArray(value)) return `Array(${value.length})`;
  const count = Object.keys(value).length;
  return `Object (${count} key${count === 1 ? '' : 's'})`;
}

function valueClass(value: unknown): string {
  if (value === null) return 't-null';
  if (value === undefined) return 't-undefined';
  switch (typeof value) {
    case 'string':
      return 't-string';
    case 'number':
      return 't-number';
    case 'boolean':
      return 't-boolean';
    default:
      return 't-other';
  }
}

function valueText(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') {
    const text = JSON.stringify(value);
    return text.length > 600 ? `${text.slice(0, 597)}…` : text;
  }
  return String(value);
}

function fullValueText(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return JSON.stringify(value);
  return String(value);
}

function primitiveText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return '';
  return String(value);
}

function selectRowText(row: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  const range = document.createRange();
  range.selectNodeContents(row);
  selection.addRange(range);
}

const INDEX_RE = /^\d+$/;

class TreeNode {
  readonly tree: JsonTree;
  readonly parent: TreeNode | null;
  readonly key: string;
  readonly value: unknown;
  readonly depth: number;
  readonly id: string;
  readonly isContainer: boolean;

  expanded = false;
  childrenBuilt = false;
  children: TreeNode[] = [];
  keys: string[] = [];
  loaded = 0;

  readonly row: HTMLDivElement;
  readonly childrenEl: HTMLDivElement;

  constructor(tree: JsonTree, parent: TreeNode | null, key: string, value: unknown, depth: number, id: string) {
    this.tree = tree;
    this.parent = parent;
    this.key = key;
    this.value = value;
    this.depth = depth;
    this.id = id;
    this.isContainer = isContainer(value);

    this.row = this.buildRow();
    this.childrenEl = document.createElement('div');
    this.childrenEl.className = 'children';
    this.childrenEl.hidden = true;
  }

  private buildRow(): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'node-row';
    row.dataset.id = this.id;

    const arrow = document.createElement('span');
    arrow.className = this.isContainer ? 'arrow' : 'arrow leaf';
    arrow.textContent = this.isContainer ? '▸' : '';

    const keyEl = document.createElement('span');
    keyEl.className = INDEX_RE.test(this.key) ? 'node-key idx' : 'node-key';
    keyEl.textContent = this.key;

    const colon = document.createElement('span');
    colon.className = 'node-colon';
    colon.textContent = ':';

    const valueEl = document.createElement('span');
    if (this.isContainer) {
      valueEl.className = 'node-summary';
      valueEl.textContent = summaryText(this.value as object);
    } else {
      valueEl.className = `node-value ${valueClass(this.value)}`;
      const text = valueText(this.value);
      valueEl.textContent = text;
      const full = fullValueText(this.value);
      if (full.length > text.length) valueEl.title = full.slice(0, 10000);
    }

    row.append(arrow, keyEl, colon, valueEl);
    row.addEventListener('click', (event) => {
      event.stopPropagation();
      if (this.isContainer) this.toggle();
      else selectRowText(row);
    });
    return row;
  }

  toggle(): void {
    if (this.expanded) this.collapse();
    else this.expand();
  }

  expand(): void {
    this.expanded = true;
    this.row.classList.add('expanded');
    this.childrenEl.hidden = false;
    this.tree.markUserExpanded(this.id);
    this.ensureChildren();
  }

  collapse(): void {
    this.expanded = false;
    this.row.classList.remove('expanded');
    this.childrenEl.hidden = true;
    this.tree.clearUserExpanded(this.id);
  }

  ensureChildren(): void {
    if (!this.isContainer || this.childrenBuilt) return;
    this.childrenBuilt = true;
    this.keys = Object.keys(this.value as object);
    this.tree.enqueue(this);
  }
}

export class JsonTree {
  private readonly container: HTMLElement;
  private root: unknown = null;
  private rootLabel = 'document';
  private filter = '';

  private readonly matched = new Set<string>();
  private readonly matchedAncestors = new Set<string>();
  private userExpanded = new Set<string>();

  private jobs: TreeNode[] = [];
  private rafId = 0;
  private destroyed = false;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  setData(value: unknown, label = 'document'): void {
    this.root = value;
    this.rootLabel = label;
    this.userExpanded.clear();
    this.rebuild();
  }

  setFilter(query: string): void {
    this.filter = query.trim().toLowerCase();
    this.recomputeMatches();
    this.rebuild();
  }

  expandAll(limit = 50000): void {
    this.userExpanded.clear();
    this.collectContainerIds(this.root, this.userExpanded, limit);
    this.rebuild();
  }

  collapseAll(): void {
    this.userExpanded.clear();
    this.rebuild();
  }

  destroy(): void {
    this.destroyed = true;
    this.cancelJobs();
    this.container.textContent = '';
  }

  /* ---------------------------------------------------------- user access */

  markUserExpanded(id: string): void {
    this.userExpanded.add(id);
  }

  clearUserExpanded(id: string): void {
    this.userExpanded.delete(id);
  }

  /* ---------------------------------------------------------------- render */

  private rebuild(): void {
    this.cancelJobs();
    this.container.textContent = '';
    this.container.classList.toggle('filter-active', this.filter.length > 0);
    if (this.root === null || this.root === undefined) return;

    const node = new TreeNode(this, null, this.rootLabel, this.root, 0, '');
    node.expanded = true;
    node.row.classList.add('expanded');
    node.childrenEl.hidden = false;
    this.container.appendChild(node.row);
    this.container.appendChild(node.childrenEl);
    node.ensureChildren();
  }

  private cancelJobs(): void {
    this.jobs = [];
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  enqueue(node: TreeNode): void {
    this.jobs.push(node);
    if (!this.rafId) this.rafId = requestAnimationFrame(this.process);
  }

  private readonly process = (): void => {
    const budget = 1200; // rows per frame
    let done = 0;

    while (this.jobs.length > 0 && done < budget) {
      const node = this.jobs[this.jobs.length - 1];
      if (this.destroyed || !node.expanded || node.loaded >= node.keys.length) {
        this.jobs.pop();
        continue;
      }

      const key = node.keys[node.loaded];
      const child = new TreeNode(
        this,
        node,
        key,
        (node.value as Record<string, unknown>)[key],
        node.depth + 1,
        node.id === '' ? key : `${node.id}${SEP}${key}`,
      );
      node.children.push(child);
      node.childrenEl.appendChild(child.row);
      node.childrenEl.appendChild(child.childrenEl);
      node.loaded++;
      done++;

      if (this.matched.has(child.id)) child.row.classList.add('match');
      if (this.matchedAncestors.has(child.id)) child.row.classList.add('ancestor');

      if (child.isContainer && (this.userExpanded.has(child.id) || this.matchedAncestors.has(child.id))) {
        // Auto-expand without touching the user-expanded set.
        child.expanded = true;
        child.row.classList.add('expanded');
        child.childrenEl.hidden = false;
        child.ensureChildren();
      }
    }

    this.rafId = 0;
    if (this.jobs.length > 0 && !this.destroyed) this.rafId = requestAnimationFrame(this.process);
  };

  /* --------------------------------------------------------------- filter */

  private recomputeMatches(): void {
    this.matched.clear();
    this.matchedAncestors.clear();
    if (!this.filter) return;

    const parentOf = new Map<string, string>();
    const stack: Array<{ key: string; value: unknown; id: string }> = [
      { key: '', value: this.root, id: '' },
    ];

    while (stack.length > 0) {
      const item = stack.pop()!;
      if (isContainer(item.value)) {
        const record = item.value as Record<string, unknown>;
        const keys = Object.keys(record);
        if (keys.length < 500000) {
          for (const key of keys) {
            const childId = item.id === '' ? key : `${item.id}${SEP}${key}`;
            parentOf.set(childId, item.id);
            stack.push({ key, value: record[key], id: childId });
          }
        }
      }

      if (item.id === '') continue;
      const haystack = `${item.key.toLowerCase()}${SEP}${primitiveText(item.value).toLowerCase()}`;
      if (haystack.includes(this.filter)) this.matched.add(item.id);
    }

    for (const id of this.matched) {
      let parent = parentOf.get(id);
      while (parent !== undefined && parent !== '') {
        this.matchedAncestors.add(parent);
        parent = parentOf.get(parent);
      }
    }
  }

  /* ------------------------------------------------------------ expand all */

  private collectContainerIds(value: unknown, out: Set<string>, limit: number): void {
    const stack: Array<{ value: unknown; id: string }> = [{ value, id: '' }];
    while (stack.length > 0 && out.size < limit) {
      const item = stack.pop()!;
      if (!isContainer(item.value)) continue;
      const record = item.value as Record<string, unknown>;
      const keys = Object.keys(record);
      for (let i = keys.length - 1; i >= 0 && out.size < limit; i--) {
        const key = keys[i];
        const childId = item.id === '' ? key : `${item.id}${SEP}${key}`;
        out.add(childId);
        stack.push({ value: record[key], id: childId });
      }
    }
  }
}
