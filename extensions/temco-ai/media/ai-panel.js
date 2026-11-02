// The panel's behaviour. The extension host owns every decision; this file only draws and forwards.
(function () {
  const vscode = acquireVsCodeApi();
  const byId = (id) => document.getElementById(id);

  const transcript = byId('transcript');
  const emptyTemplate = byId('emptyTemplate');
  const input = byId('text');
  const form = byId('form');
  const send = byId('send');
  const draft = byId('draft');
  const area = byId('area');
  const apply = byId('apply');
  const models = byId('models');
  const newChat = byId('newChat');
  const box = byId('box');
  const where = byId('where');
  const model = byId('model');
  const dot = byId('dot');

  let busy = false;
  let streaming = null;
  let said = false;
  /** The page-said-nothing block: rebuilt from its template, so a new chat can put it back. */
  let empty = null;
  /** The "no model yet" line inside that block — replaced every time the block is rebuilt. */
  let note = null;
  /** What this panel is about, as the block above the acts says it — replaced on every rebuild too. */
  let reading = null;
  /** The last state the host sent, so a block rebuilt by a new chat can be told what is true of it. */
  let last = null;

  /**
   * Puts the pre-conversation block back and binds what lives inside it.
   *
   * A new chat is the same panel as the first time it was opened, so the block is a template rather than markup that
   * is thrown away: dropping it would leave a cleared panel with nothing to say.
   */
  function mount() {
    transcript.textContent = '';
    said = false;
    streaming = null;
    transcript.appendChild(emptyTemplate.content.cloneNode(true));
    empty = transcript.querySelector('.empty');
    note = byId('modelNote');
    reading = byId('reading');

    const choose = byId('chooseModel');
    if (choose) {
      choose.addEventListener('click', () => vscode.postMessage({ type: 'models' }));
    }
    // An example prompt puts its words in the box rather than sending them: they are a start, not a question.
    for (const example of transcript.querySelectorAll('.ask')) {
      example.addEventListener('click', () => {
        if (example.disabled) {
          return;
        }
        input.value = example.dataset.text || '';
        sync();
        input.focus();
      });
    }
    // The block is new, so what the host last said about the panel has to be said again to it.
    if (last) {
      state(last);
    }
  }

  /** The send button is the one control that reflects the box: nothing to ask, nothing to send. */
  function sync() {
    const filled = input.value.trim().length > 0;
    send.disabled = !busy && !filled;
    box.classList.toggle('filled', filled);
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 220) + 'px';
  }

  function atBottom() {
    return transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 40;
  }

  function scroll(force) {
    if (force || atBottom()) {
      transcript.scrollTop = transcript.scrollHeight;
    }
  }

  function turn(kind, text) {
    if (!said && empty) {
      empty.remove();
      empty = null;
      said = true;
    }
    const element = document.createElement('div');
    element.className = 'turn ' + kind;
    const body = document.createElement('div');
    body.className = 'body';
    body.textContent = text || '';
    element.appendChild(body);
    transcript.appendChild(element);
    scroll(true);
    return body;
  }

  function setBusy(value) {
    busy = value;
    send.classList.toggle('stop', value);
    send.title = value ? 'Stop' : 'Ask about this page (Enter)';
    send.querySelector('.icon-send').classList.toggle('hidden', value);
    send.querySelector('.icon-stop').classList.toggle('hidden', !value);
    draft.disabled = value;
    area.disabled = value;
    models.disabled = value;
    input.disabled = false;
    sync();
  }

  function chips(items) {
    const row = document.createElement('div');
    row.className = 'chips';
    for (const item of items) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip' + (item.stale ? ' stale' : '');
      chip.textContent = item.id.split('/').pop() + (item.stale ? ' \u00b7 stale' : '');
      chip.title = (item.stale ? 'stale \u00b7 ' : '') + item.id + ' \u2014 ' + item.title;
      chip.addEventListener('click', () => vscode.postMessage({ type: 'open', id: item.id }));
      row.appendChild(chip);
    }
    transcript.appendChild(row);
    scroll(true);
  }

  function state(next) {
    last = next;
    const page = next.page
      ? next.page.title + (next.page.stale ? ' \u00b7 stale' : '')
      : 'no page open';
    where.textContent = next.project ? next.project + ' \u2014 ' + page : page;
    where.title = next.page ? next.page.id : 'Open a page from the Workspace view';
    model.textContent = next.model
      ? next.model + ' \u00b7 offline' + (next.version ? ' \u00b7 ' + next.version : '')
      : next.runtimeReady
        ? 'no model chosen'
        : 'nothing installed';
    dot.classList.toggle('live', Boolean(next.model));
    // The one thing worth saying before anything else: without a model, none of the rest of this can happen.
    if (note) {
      note.classList.toggle('hidden', Boolean(next.model));
    }
    if (reading) {
      reading.textContent = next.page
        ? 'Reading ' + next.page.title + (next.project ? ' in ' + next.project : '') +
          (next.page.stale ? ' \u2014 its code moved since the last review.' : '.')
        : 'No page open yet \u2014 open one from the Workspace and this panel answers about it.';
      reading.classList.toggle('idle', !next.page);
    }
    // An example that cannot work yet says so before it is clicked, not after: draft and ask are about the page in
    // front, and the area question is about the project around it.
    const cannot = !next.page
      ? 'Open a page first \u2014 the AI works from the page in front.'
      : !next.model
        ? 'No model is installed yet.'
        : '';
    for (const example of transcript.querySelectorAll('.ask[data-needs="page"]')) {
      example.disabled = cannot.length > 0;
      example.title = cannot;
    }
    const noProject = !next.project && !next.page
      ? 'Open a project first \u2014 the area question is about the pages around this one.'
      : !next.model ? 'No model is installed yet.' : '';
    for (const example of transcript.querySelectorAll('.ask[data-needs="project"]')) {
      example.disabled = noProject.length > 0;
      example.title = noProject;
    }
    apply.classList.toggle('hidden', !next.canApply);
    if (typeof next.busy === 'boolean') {
      setBusy(next.busy);
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (busy) {
      vscode.postMessage({ type: 'stop' });
      return;
    }
    const text = input.value.trim();
    if (text.length === 0) {
      return;
    }
    vscode.postMessage({ type: 'ask', text: text });
    input.value = '';
    sync();
  });

  draft.addEventListener('click', () => {
    vscode.postMessage({ type: 'draft', text: input.value.trim() });
  });

  area.addEventListener('click', () => {
    vscode.postMessage({ type: 'area', text: input.value.trim() });
  });

  apply.addEventListener('click', () => vscode.postMessage({ type: 'apply' }));
  models.addEventListener('click', () => vscode.postMessage({ type: 'models' }));
  newChat.addEventListener('click', () => vscode.postMessage({ type: 'newChat' }));

  input.addEventListener('keydown', (event) => {
    // Enter sends; Shift+Enter starts a new line, as in every chat box.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  input.addEventListener('input', sync);

  window.addEventListener('message', (event) => {
    const message = event.data || {};
    switch (message.type) {
      case 'state':
        state(message);
        return;
      case 'reset':
        mount();
        setBusy(false);
        return;
      case 'user':
        turn('user', message.text || '');
        return;
      case 'start':
        streaming = turn('assistant', '');
        return;
      case 'chunk':
        if (streaming) {
          streaming.textContent += message.text;
          scroll(false);
        }
        return;
      case 'end':
        streaming = null;
        return;
      case 'busy':
        setBusy(message.busy === true);
        return;
      case 'note':
        turn('note', message.text);
        return;
      case 'citations':
        chips(message.items || []);
        return;
      case 'results':
        turn('note', message.text || '');
        chips(message.items || []);
        return;
      case 'error':
        turn('error', message.text);
        return;
      default:
        return;
    }
  });

  mount();
  sync();
})();
