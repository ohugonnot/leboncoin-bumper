/**
 * Setup commun pour les tests d'intégration popup.
 *
 * Stratégie : DOM stub maison — zéro dépendance, crée exactement les IDs
 * utilisés par les modules popup. Les modules bumper.js / prospect-ui.js
 * font leurs getElementById au top-level, donc le DOM doit être peuplé
 * AVANT le premier import de ces modules (géré via les helpers ci-dessous).
 */

// ── Minimal DOM stub ─────────────────────────────────────────────────────────

class StubElement {
  constructor(tagName, id) {
    this.tagName = (tagName || 'div').toUpperCase();
    this.id = id || '';
    this.type = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.textContent = '';
    this._innerHTML = '';
    this._className = '';
    this.style = {};
    this.dataset = {};
    this.title = '';
    this._children = [];
    this._htmlChildren = []; // virtual children parsed from innerHTML
    this._listeners = {};
    this._attrs = {};

    // classList — simple string-set based implementation
    const self = this;
    this.classList = {
      _set: new Set(),
      add(cls) { self._className += (self._className ? ' ' : '') + cls; this._set.add(cls); },
      remove(cls) {
        this._set.delete(cls);
        self._className = [...this._set].join(' ');
      },
      toggle(cls, force) {
        if (force === undefined) force = !this._set.has(cls);
        if (force) this.add(cls); else this.remove(cls);
        return force;
      },
      contains(cls) { return this._set.has(cls); },
    };
  }

  get className() { return this._className; }
  set className(v) {
    this._className = v || '';
    this.classList._set = new Set(this._className.split(' ').filter(Boolean));
  }

  // When innerHTML is set, we parse class names out of the HTML string so
  // querySelector('.foo') can find the corresponding stub element.
  get innerHTML() { return this._innerHTML; }
  set innerHTML(html) {
    this._innerHTML = html;
    this._children = [];
    this._htmlChildren = [];
    // Extract all <tag class="..."> occurrences from the HTML string
    const tagRe = /<(\w+)[^>]*class="([^"]*)"[^>]*>/g;
    let m;
    while ((m = tagRe.exec(html)) !== null) {
      const child = new StubElement(m[1], '');
      child.className = m[2];
      this._htmlChildren.push(child);
    }
    // Also extract id="..." elements
    const idRe = /<(\w+)[^>]*\bid="([^"]+)"[^>]*>/g;
    while ((m = idRe.exec(html)) !== null) {
      const child = new StubElement(m[1], m[2]);
      this._htmlChildren.push(child);
    }
  }

  get files() { return this._files || null; }
  set files(v) { this._files = v; }

  addEventListener(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
  }
  removeEventListener(event, fn) {
    if (this._listeners[event]) {
      this._listeners[event] = this._listeners[event].filter(f => f !== fn);
    }
  }
  dispatchEvent(event) {
    const fns = this._listeners[event?.type || event] || [];
    fns.forEach(fn => fn(event));
  }
  click() { this.dispatchEvent({ type: 'click', preventDefault: () => {} }); }

  appendChild(child) { this._children.push(child); return child; }
  remove() { this.hidden = true; }
  querySelector(sel) {
    // Search _htmlChildren (from innerHTML) first, then _children (from appendChild)
    const allChildren = [...this._htmlChildren, ...this._children];
    for (const c of allChildren) {
      if (c._matchSelector && c._matchSelector(sel)) return c;
      const found = c.querySelector && c.querySelector(sel);
      if (found) return found;
    }
    return null;
  }
  querySelectorAll(sel) {
    const results = [];
    const allChildren = [...this._htmlChildren, ...this._children];
    for (const c of allChildren) {
      if (c._matchSelector && c._matchSelector(sel)) results.push(c);
      if (c.querySelectorAll) results.push(...c.querySelectorAll(sel));
    }
    return results;
  }
  _matchSelector(sel) {
    if (sel.startsWith('.')) return this.className.split(' ').includes(sel.slice(1));
    if (sel.startsWith('#')) return this.id === sel.slice(1);
    return this.tagName.toLowerCase() === sel.toLowerCase();
  }
  setAttribute(k, v) { this._attrs[k] = v; }
  getAttribute(k) { return this._attrs[k] ?? null; }
  get scrollTop() { return 0; }
  set scrollTop(v) {}
  get scrollHeight() { return 0; }
}

class StubBody extends StubElement {
  constructor() { super('body', ''); this._elMap = {}; }
}

// IDs présents dans popup.html — générés depuis une lecture exhaustive du HTML.
const HTML_IDS = [
  // header
  'login-dot', 'open-in-tab', 'login-banner',
  // bumper panel
  'panel-bumper',
  'b-help', 'b-selection-bar', 'b-select-all', 'b-select-none', 'b-selection-hint',
  'b-listings', 'b-refresh-listings',
  'b-runNow', 'b-smartBump', 'b-dryRun', 'b-action-hint', 'b-smart-bump-confirm',
  'b-backup-export', 'b-backup-import', 'b-backup-import-file', 'b-backup-include-photos', 'b-backup-status',
  'b-bump-progress',
  'b-meta-last', 'b-meta-next', 'b-meta-peak',
  'b-history-section', 'b-history-list',
  'b-planning-section', 'b-peak-coverage',
  'b-enabled', 'b-dayOfWeek', 'b-hour', 'b-minute', 'b-jitterMinutes',
  'b-log-section', 'b-log', 'b-clearLog',
  // messages panel
  'panel-messages',
  'm-stat-scam', 'm-stat-lead', 'm-stat-question', 'm-stat-spam', 'm-stat-archived',
  'm-last-run', 'm-refresh', 'm-error-banner', 'm-error-text',
  'm-help', 'm-search', 'm-empty-hint', 'm-list',
  // prospect panel
  'panel-prospect',
  'p-profile-select', 'p-profile-add', 'p-profile-rename', 'p-profile-delete',
  'p-enabled', 'p-frequency', 'p-dayOfWeek', 'p-hour',
  'p-minScore', 'p-maxAgeDays', 'p-adType',
  'p-priceMin', 'p-priceMax', 'p-departments',
  'p-sortBy', 'p-ownerType', 'p-shippableOnly',
  'p-notifyOnNew', 'p-notifyMinScore',
  'p-keywords', 'p-replyTemplate',
  'p-scan', 'p-mark-seen',
  'p-stat-new', 'p-stat-total', 'p-last-run',
  'p-scan-progress', 'p-empty-hint',
  'p-list',
];

/**
 * Installe un document/window global stub avec tous les IDs du HTML.
 * Doit être appelé AVANT tout import de module popup.
 */
export function installDOMStub() {
  const elMap = {};

  function createElement(tag, id) {
    const el = new StubElement(tag, id);
    // select elements need a value property that syncs
    if (tag === 'select' || tag === 'input' || tag === 'textarea') {
      el.type = tag === 'input' ? 'text' : '';
    }
    return el;
  }

  // Create all known IDs
  for (const id of HTML_IDS) {
    elMap[id] = createElement('div', id);
  }

  // Special types for form elements
  const inputIds = [
    'b-dryRun', 'b-backup-include-photos', 'b-enabled',
    'p-enabled', 'p-notifyOnNew', 'p-shippableOnly',
    'b-backup-import-file',
  ];
  for (const id of inputIds) {
    elMap[id] = createElement('input', id);
    elMap[id].type = (id === 'b-backup-import-file') ? 'file' : 'checkbox';
  }
  elMap['b-dryRun'].checked = true; // default checked

  const numberIds = [
    'b-hour', 'b-minute', 'b-jitterMinutes',
    'p-hour', 'p-minScore', 'p-maxAgeDays', 'p-priceMin', 'p-priceMax',
    'p-notifyMinScore',
  ];
  for (const id of numberIds) {
    elMap[id] = createElement('input', id);
    elMap[id].type = 'number';
    elMap[id].value = '0';
  }

  const selectIds = ['b-dayOfWeek', 'p-frequency', 'p-dayOfWeek', 'p-adType', 'p-sortBy', 'p-ownerType', 'p-profile-select'];
  for (const id of selectIds) {
    elMap[id] = createElement('select', id);
    elMap[id].value = '';
  }

  const textareaIds = ['p-keywords', 'p-replyTemplate'];
  for (const id of textareaIds) {
    elMap[id] = createElement('textarea', id);
  }

  const body = new StubBody();
  body._elMap = elMap;

  // querySelectorAll on body/document for filter buttons and tabs
  const inboxFilterBtns = ['all', 'scam', 'lead', 'question', 'spam', 'archived'].map(f => {
    const btn = createElement('button', '');
    btn.className = 'inbox-filter' + (f === 'all' ? ' active' : '');
    btn.dataset = { filter: f };
    btn.textContent = f;
    return btn;
  });

  const tabBtns = ['bumper', 'messages', 'prospect'].map((tab, i) => {
    const btn = createElement('button', '');
    btn.className = 'tab' + (i === 0 ? ' active' : '');
    btn.dataset = { tab };
    btn.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
    return btn;
  });

  const panelEls = ['bumper', 'messages', 'prospect'].map((panel, i) => {
    const el = createElement('section', `panel-${panel}`);
    el.className = 'panel' + (i === 0 ? ' active' : '');
    el.dataset = { panel };
    elMap[`panel-${panel}`] = el;
    return el;
  });

  const showWhenEls = ['day,week', 'week'].map(sw => {
    const el = createElement('div', '');
    el.dataset = { showWhen: sw };
    return el;
  });

  const prospectMetaEl = createElement('div', '');
  prospectMetaEl.className = 'prospect-meta';

  // document stub
  const doc = {
    getElementById: (id) => elMap[id] || null,
    createElement: (tag) => createElement(tag, ''),
    querySelectorAll: (sel) => {
      if (sel === '.inbox-filter') return inboxFilterBtns;
      if (sel === '.tab') return tabBtns;
      if (sel === '.panel') return panelEls;
      if (sel === '[data-show-when]') return showWhenEls;
      if (sel === '.prospect-meta') return [prospectMetaEl];
      return [];
    },
    querySelector: (sel) => {
      if (sel === '.prospect-meta') return prospectMetaEl;
      return null;
    },
    body,
  };

  global.document = doc;
  global.window = {
    addEventListener: () => {},
    close: () => {},
    location: { search: '' },
  };
  global.navigator = { clipboard: { writeText: async () => {} } };
  global.confirm = () => true;
  global.prompt = () => 'Test';
  global.URL = {
    createObjectURL: () => 'blob:test',
    revokeObjectURL: () => {},
  };
  global.Blob = class Blob {
    constructor(parts) { this._content = parts.join(''); }
  };
  global.setTimeout = (fn, ms) => { /* noop in sync tests — use flushTimers when needed */ return 1; };
  global.clearTimeout = () => {};
  global.fetch = async () => ({ ok: true, json: async () => ({}) });

  return { elMap, inboxFilterBtns, tabBtns, panelEls };
}

// ── Chrome mock factory ───────────────────────────────────────────────────────

export function makeChromeMock(storageData = {}) {
  const storage = { ...storageData };
  const listeners = { onChanged: [] };

  const chromeMock = {
    storage: {
      local: {
        get: async (keys) => {
          if (typeof keys === 'string') {
            return { [keys]: storage[keys] };
          }
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map(k => [k, storage[k]]));
          }
          return { ...storage };
        },
        set: async (updates) => {
          const changes = {};
          for (const [k, v] of Object.entries(updates)) {
            changes[k] = { oldValue: storage[k], newValue: v };
            storage[k] = v;
          }
          listeners.onChanged.forEach(fn => fn(changes));
        },
        onChanged: {
          addListener: (fn) => listeners.onChanged.push(fn),
          removeListener: (fn) => { listeners.onChanged = listeners.onChanged.filter(f => f !== fn); },
        },
      },
    },
    runtime: {
      sendMessage: async (msg) => {
        // Default stub — override in individual tests via chromeMock.runtime.sendMessage
        return { ok: true, result: {} };
      },
      onMessage: {
        addListener: () => {},
        removeListener: () => {},
      },
      getURL: (path) => `chrome-extension://test/${path}`,
    },
    tabs: {
      create: async (opts) => ({ id: 1, ...opts }),
    },
    scripting: {
      executeScript: async () => [{ result: null }],
    },
    alarms: {
      create: async () => {},
      clear: async () => {},
      get: async () => null,
      getAll: async () => [],
      onAlarm: { addListener: () => {} },
    },
    notifications: {
      create: async () => {},
    },
    _storage: storage,
    _listeners: listeners,
  };

  return chromeMock;
}

/**
 * Flush micro-tasks (promise queue) — pour attendre la résolution des
 * async handlers déclenchés par un click.
 */
export async function flushPromises() {
  // 10 ticks de microtâches couvrent les chaînes async await à 1-2 niveaux.
  for (let i = 0; i < 10; i++) {
    await new Promise(resolve => setImmediate ? setImmediate(resolve) : Promise.resolve().then(resolve));
  }
}
