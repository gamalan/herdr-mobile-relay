const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('web/index.html', 'utf8');
assert.match(html, /\.term-content \{[^}]*padding: 10px 16px/);
assert.match(html, /\.ansi-line \{[^}]*overflow: hidden/);
assert.match(html, /\.composer-field\.awaiting-approval textarea \{[^}]*line-height: 42px;[^}]*text-align: center/);
const colorsStart = html.indexOf('const ANSI_COLORS =');
const colorsEnd = html.indexOf('\n};', colorsStart) + 3;
const rendererStart = html.indexOf('function trimAnsiLineEnd');
const rendererEnd = html.indexOf('function hostLabel', rendererStart);

assert.ok(colorsStart >= 0 && colorsEnd > colorsStart, 'ANSI color table not found');
assert.ok(rendererStart >= 0 && rendererEnd > rendererStart, 'ANSI renderer not found');

const sandbox = {};
vm.runInNewContext(`
${html.slice(colorsStart, colorsEnd)}
const TERMINAL_SEPARATOR_TOKEN = '\\uE000HERDR_SEPARATOR\\uE000';
${html.slice(rendererStart, rendererEnd)}
this.ansi256Color = ansi256Color;
this.ansiToHtml = ansiToHtml;
this.isNearWhiteAnsiColor = isNearWhiteAnsiColor;
this.ansiLineBackground = ansiLineBackground;
this.ansiLineBackgroundIndent = ansiLineBackgroundIndent;
this.ansiLineBackgroundStyle = ansiLineBackgroundStyle;
this.ansiLineBackgrounds = ansiLineBackgrounds;
this.terminalHtml = terminalHtml;
this.lastCompletedResponse = lastCompletedResponse;
`, sandbox);

assert.equal(sandbox.ansi256Color(6), '#1abc9c');
assert.equal(sandbox.ansi256Color(196), 'rgb(255,0,0)');
assert.equal(sandbox.ansi256Color(244), 'rgb(128,128,128)');

const tools = sandbox.ansiToHtml('\x1b[38;5;6mSearch\x1b[0m and \x1b[38;5;6mRead\x1b[0m');
assert.match(tools, /color:#1abc9c[^>]*>Search/);
assert.match(tools, /color:#1abc9c[^>]*>Read/);

const background = sandbox.ansiToHtml('\x1b[1;48;5;196mAlert\x1b[0m');
assert.match(background, /font-weight:700/);
assert.match(background, /background-color:rgb\(255,0,0\)/);

const explored = sandbox.terminalHtml('\x1b[1mExplored\x1b[0m');
assert.match(explored, /font-weight:700;color:#5fafff[^>]*>Explored/);

const claudeHeading = sandbox.terminalHtml(
  '  \x1b[0m\x1b[1mWhat happened:\x1b[0m normal explanation',
  false,
  true
);
assert.match(claudeHeading, /font-weight:700;color:rgb\(56,162,223\)[^>]*>What happened:/);
const claudeSplitColonHeading = sandbox.terminalHtml(
  '  \x1b[0m\x1b[1mThe fix in start.sh\x1b[0m: normal explanation',
  false,
  true
);
assert.match(claudeSplitColonHeading, /font-weight:700;color:rgb\(56,162,223\)[^>]*>The fix in start\.sh:/);
const claudeEmphasis = sandbox.terminalHtml('\x1b[1mRoot cause found and fixed.\x1b[0m', false, true);
assert.match(claudeEmphasis, /font-weight:700[^>]*>Root cause found and fixed/);
assert.doesNotMatch(claudeEmphasis, /color:rgb\(56,162,223\)/);
const claudeStandaloneHeading = sandbox.terminalHtml('  \x1b[0m\x1b[1mCode style\x1b[0m\n', false, true);
assert.match(claudeStandaloneHeading, /font-weight:700;color:rgb\(56,162,223\)[^>]*>Code style/);
const claudeListLeadIn = sandbox.terminalHtml(
  '  - \x1b[0m\x1b[1mReconnect is a fixed 3-second loop forever.\x1b[0m Normal explanation',
  false,
  true
);
assert.match(
  claudeListLeadIn,
  /font-weight:700;color:rgb\(56,162,223\)[^>]*>Reconnect is a fixed 3-second loop forever\./
);
const claudeBulletEmphasis = sandbox.terminalHtml('• \x1b[1mImportant emphasis.\x1b[0m\n', false, true);
assert.doesNotMatch(claudeBulletEmphasis, /color:rgb\(56,162,223\)/);

// Claude emits question prompts as black truecolor text even though the phone
// terminal is always dark. Restore the terminal foreground only on rows that
// do not carry their own background; black-on-light prompts keep their contrast.
const claudeQuestion = sandbox.terminalHtml(
  '\x1b[1;38;2;0;0;0mWhich phone environments should be included?\x1b[0m',
  false,
  true
);
assert.match(claudeQuestion, /color:var\(--terminal-text\)[^>]*>Which phone environments/);
const claudeLightPrompt = sandbox.terminalHtml(
  '\x1b[38;2;0;0;0;48;2;240;240;240mBlack text on a light row\x1b[0m',
  false,
  true
);
assert.match(claudeLightPrompt, /color:rgb\(0,0,0\)/);
assert.doesNotMatch(claudeLightPrompt, /color:var\(--terminal-text\)/);

const prompt = sandbox.terminalHtml([
  '\x1b[48;2;61;64;64m› First prompt paragraph   \x1b[0m',
  '\r',
  '\x1b[48;2;61;64;64mSecond paragraph that wraps on a phone   \x1b[0m',
].join('\n'));
assert.equal(sandbox.ansiLineBackground('\x1b[48;2;61;64;64m› Prompt\x1b[0m'), 'rgb(61,64,64)');
assert.match(prompt, /class="ansi-line ansi-line-background" style="background-color:rgb\(61,64,64\)"/);
assert.equal((prompt.match(/class="ansi-line ansi-line-background"/g) || []).length, 3);
assert.doesNotMatch(prompt, /paragraph {3}/);

const claudeToolHeader = sandbox.terminalHtml(
  '\x1b[0m\x1b[38;2;78;186;101m● \x1b[0m\x1b[1mUpdate\x1b[0m(relay/start.sh)',
  false,
  true
);
assert.doesNotMatch(claudeToolHeader, /background-color|background-image/);
assert.match(claudeToolHeader, /color:rgb\(78,186,101\)[^>]*>●/);

const claudeDiff = sandbox.terminalHtml(
  '     \x1b[38;2;80;200;80m\x1b[48;2;2;40;0m  88 +\x1b[0m\x1b[48;2;2;40;0m changed code\x1b[0m',
  false,
  true
);
assert.equal(
  sandbox.ansiLineBackground('     \x1b[38;2;80;200;80m\x1b[48;2;2;40;0m  88 +\x1b[0m'),
  'rgb(2,40,0)'
);
assert.match(claudeDiff, /background-image:linear-gradient\(to right,transparent 0 5ch,rgb\(2,40,0\) 5ch\)/);
assert.match(claudeDiff, /padding-left:5ch;text-indent:-5ch/);

const separateBlocks = sandbox.ansiLineBackgrounds([
  '\x1b[48;5;1mFirst block\x1b[0m',
  '',
  'Normal output',
  '',
  '\x1b[48;5;1mSecond block\x1b[0m',
]);
assert.deepEqual(separateBlocks, ['#ff5f5f', '', '', '', '#ff5f5f']);

assert.equal(sandbox.isNearWhiteAnsiColor('#fff'), true);
assert.equal(sandbox.isNearWhiteAnsiColor('#e5e5e5'), true);
assert.equal(sandbox.isNearWhiteAnsiColor('rgb(242,242,242)'), true);
assert.equal(sandbox.isNearWhiteAnsiColor('rgb(220,220,180)'), false);

for (const lightBackground of [
  '\x1b[107m› Standard bright-white prompt\x1b[0m',
  '\x1b[48;5;15m› ANSI-256 white prompt\x1b[0m',
  '\x1b[48;2;242;242;242m› Truecolor near-white prompt\x1b[0m',
]) {
  const normalized = sandbox.terminalHtml(lightBackground, true);
  assert.match(normalized, /class="ansi-line ansi-line-background" style="background-color:rgb\(61,64,64\)"/);
  assert.doesNotMatch(normalized, /background-color:(?:#fff|rgb\(242,242,242\))/);
}

// Colorless bold+italic mirrors herdr's theme accent (Codex markdown
// headings); plain italic and explicitly colored italic retain their styles.
const italicHeading = sandbox.ansiToHtml('\x1b[0m\x1b[1m\x1b[3m### Heading\x1b[0m');
assert.match(italicHeading, /font-style:italic/);
assert.match(italicHeading, /color:#3daee9/);
const plainItalic = sandbox.ansiToHtml('\x1b[3memphasized text\x1b[0m');
assert.match(plainItalic, /font-style:italic/);
assert.doesNotMatch(plainItalic, /#3daee9/);
const italicColored = sandbox.ansiToHtml('\x1b[3;38;2;148;226;213mteal italic\x1b[0m');
assert.match(italicColored, /color:rgb\(148,226,213\)/);
assert.doesNotMatch(italicColored, /#3daee9/);

const nonCodexWhite = sandbox.terminalHtml('\x1b[107mWhite row\x1b[0m');
assert.match(nonCodexWhite, /background-color:#fff/);

const inlineWhite = sandbox.terminalHtml('Normal text \x1b[107mwhite highlight\x1b[0m', true);
assert.match(inlineWhite, /background-color:#fff/);
assert.doesNotMatch(inlineWhite, /ansi-line-background/);

const codexResponse = sandbox.lastCompletedResponse([
  '• Earlier answer.',
  '─ Worked for 2s ─',
  '',
  '› New question',
  '',
  '• Latest answer.',
  '  - First detail',
  '  - Second detail',
  '',
  '─ Worked for 8m 05s ─',
  '',
  '› Next question',
].join('\n'));
assert.equal(codexResponse, 'Latest answer.\n- First detail\n- Second detail');

const claudeResponse = sandbox.lastCompletedResponse([
  '● Read 2 files',
  '',
  '● The implementation is ready.',
  '  It works on both agents.',
  '',
  '\x1b[2m✻ Crunched for 1m 49s\x1b[0m',
  '❯ ',
].join('\n'));
assert.equal(claudeResponse, 'The implementation is ready.\nIt works on both agents.');
assert.equal(sandbox.lastCompletedResponse('● Still working\n'), '');
assert.match(html, /aria-label="Copy last agent response"/);
assert.match(
  html,
  /error\.data && error\.data\.interaction[\s\S]*?applyQuestionInteraction\(agent, error\.data\.interaction, true\)/,
  'a partially applied question command must rebuild its draft from Claude',
);

// DOM writes in the terminal view must be skipped when nothing changed:
// unconditional rebuilds at polling frequency flicker the approval buttons
// and cancel Android's keyboard suggestion session while it initialises.
assert.match(html, /function updateTerminalContent[\s\S]*?if \(displayContent === lastTerminalDisplayContent && format === lastTerminalFormat\) return;/);
assert.match(html, /function updateTerminalContent[\s\S]*?if \(composerHasFocus\(\)\)[\s\S]*?pendingTerminalFrame[\s\S]*?return;/);
assert.match(html, /function syncTerminalChrome[\s\S]*?if \(signature !== lastTerminalChrome\)/);
assert.match(html, /termInput'\)\.addEventListener\('blur', handleComposerBlur\)/);

// A genuinely changing frame must also leave the DOM untouched while the
// Android IME owns the composer; only the newest frame needs to survive.
const contentStart = html.indexOf('function updateTerminalContent');
const contentEnd = html.indexOf('function terminalDisplayContent', contentStart);
assert.ok(contentStart >= 0 && contentEnd > contentStart, 'terminal content updater not found');
const terminalEl = {
  scrollHeight: 100,
  scrollTop: 50,
  clientHeight: 50,
  htmlWrites: 0,
  set innerHTML(value) { this.rendered = value; this.htmlWrites += 1; },
};
let composerFocused = true;
const contentSandbox = {
  document: {getElementById: () => terminalEl},
  composerHasFocus: () => composerFocused,
  compactSeparatorLines: value => value,
  terminalDisplayContent: value => value,
  activeAgent: () => ({agent: 'codex'}),
  terminalHtml: value => value,
  hideJumpToBottom: () => {},
  showJumpToBottom: () => {},
};
vm.runInNewContext(`
let activePane = 'relay::w1:p1';
let pendingTerminalFrame = null;
let lastTerminalDisplayContent = '';
let lastTerminalFormat = '';
${html.slice(contentStart, contentEnd)}
this.updateTerminalContent = updateTerminalContent;
this.pendingFrame = () => pendingTerminalFrame;
`, contentSandbox);
contentSandbox.updateTerminalContent('first live frame', 'ansi');
contentSandbox.updateTerminalContent('newest live frame', 'ansi');
assert.equal(terminalEl.htmlWrites, 0, 'focused composer must defer changing terminal frames');
assert.equal(contentSandbox.pendingFrame().content, 'newest live frame');
composerFocused = false;
contentSandbox.updateTerminalContent(contentSandbox.pendingFrame().content, 'ansi');
assert.equal(terminalEl.htmlWrites, 1);
assert.equal(terminalEl.rendered, 'newest live frame');

// A single contradictory polling snapshot must not clear controls installed
// by an explicit blocked event. A second consecutive snapshot confirms the
// transition, while a response initiated from the phone may clear at once.
const mergeStart = html.indexOf('function mergeAgentList');
const mergeEnd = html.indexOf('function removeAgentsForRelay', mergeStart);
assert.ok(mergeStart >= 0 && mergeEnd > mergeStart, 'agent snapshot merge functions not found');
assert.match(
  html,
  /msg\.type === 'agent_update'[\s\S]*?mergeAgentDetails\(a, stabilizeBlockedSnapshot\(a, next\)\)/,
  'event updates must use the same blocked-state stabilization as polling snapshots',
);
const mergeSandbox = {};
vm.runInNewContext(`
let agents = [];
let blockedSnapshotMisses = new Map();
let respondingPaneIds = new Set();
function agentStatusGroup(agent) { return agent && agent.status === 'blocked' ? 'blocked' : 'working'; }
function agentUpdatedAt(agent) { return Number(agent && agent.updated_at || 0); }
${html.slice(mergeStart, mergeEnd)}
this.mergeAgentList = mergeAgentList;
this.mergePaneContentInteraction = mergePaneContentInteraction;
this.setAgents = value => { agents = value; };
this.respondingPaneIds = respondingPaneIds;
`, mergeSandbox);
const blockedSnapshot = {
  relay_id: 'relay',
  pane_id: 'relay::w1:p1',
  status: 'blocked',
  prompt: 'Approval prompt',
  command: 'touch marker',
  options: ['yes', 'always', 'no'],
};
const workingSnapshot = {relay_id: 'relay', pane_id: 'relay::w1:p1', status: 'working'};
mergeSandbox.setAgents([blockedSnapshot]);
const firstNonBlocked = mergeSandbox.mergeAgentList('relay', [workingSnapshot])[0];
assert.equal(firstNonBlocked.status, 'blocked');
assert.equal(firstNonBlocked.command, 'touch marker');
mergeSandbox.setAgents([firstNonBlocked]);
const confirmedNonBlocked = mergeSandbox.mergeAgentList('relay', [workingSnapshot])[0];
assert.equal(confirmedNonBlocked.status, 'working');

mergeSandbox.setAgents([blockedSnapshot]);
mergeSandbox.respondingPaneIds.add(blockedSnapshot.pane_id);
const phoneResponse = mergeSandbox.mergeAgentList('relay', [workingSnapshot])[0];
assert.equal(phoneResponse.status, 'working');

// Missing form markup is not evidence that a blocked question ended: Claude
// redraws the TUI in several writes. Preserve the overlay until stabilized
// agent status confirms the transition, exactly like approval buttons.
const structuredQuestion = {id: 'question-1', question: 'Choose scope'};
const blockedQuestionAgent = {
  status: 'blocked',
  interaction: structuredQuestion,
  question_layout: true,
};
assert.equal(
  mergeSandbox.mergePaneContentInteraction(blockedQuestionAgent, {
    interaction: null,
    question_layout: false,
  }),
  false
);
assert.equal(blockedQuestionAgent.interaction, structuredQuestion);
assert.equal(
  mergeSandbox.mergePaneContentInteraction(blockedQuestionAgent, {
    interaction: null,
    question_layout: false,
  }),
  false
);
assert.equal(blockedQuestionAgent.interaction, structuredQuestion);
assert.equal(
  mergeSandbox.mergePaneContentInteraction(blockedQuestionAgent, {
    interaction: {...structuredQuestion},
    question_layout: true,
  }),
  false
);
blockedQuestionAgent.status = 'working';
assert.equal(
  mergeSandbox.mergePaneContentInteraction(blockedQuestionAgent, {
    interaction: {...structuredQuestion},
    question_layout: true,
  }),
  true
);
assert.equal(blockedQuestionAgent.status, 'blocked');
blockedQuestionAgent.status = 'working';
assert.equal(
  mergeSandbox.mergePaneContentInteraction(blockedQuestionAgent, {
    interaction: null,
    question_layout: false,
  }),
  true
);
assert.equal(blockedQuestionAgent.interaction, null);
assert.equal(blockedQuestionAgent.question_layout, false);

const retainedQuestion = {
  relay_id: 'relay',
  pane_id: 'relay::w1:p2',
  status: 'blocked',
  interaction: structuredQuestion,
  question_layout: true,
};
mergeSandbox.setAgents([retainedQuestion]);
const partialBlockedEvent = mergeSandbox.mergeAgentList('relay', [{
  relay_id: 'relay',
  pane_id: retainedQuestion.pane_id,
  status: 'blocked',
  interaction: null,
  question_layout: false,
}])[0];
assert.equal(partialBlockedEvent.interaction.id, 'question-1');
assert.equal(partialBlockedEvent.question_layout, true);
mergeSandbox.setAgents([partialBlockedEvent]);
const firstQuestionMiss = mergeSandbox.mergeAgentList('relay', [
  {relay_id: 'relay', pane_id: retainedQuestion.pane_id, status: 'working'},
])[0];
assert.equal(firstQuestionMiss.status, 'blocked');
assert.equal(firstQuestionMiss.interaction.id, 'question-1');
mergeSandbox.setAgents([firstQuestionMiss]);
const confirmedQuestionExit = mergeSandbox.mergeAgentList('relay', [
  {relay_id: 'relay', pane_id: retainedQuestion.pane_id, status: 'working'},
])[0];
assert.equal(confirmedQuestionExit.status, 'working');
assert.equal(confirmedQuestionExit.interaction, undefined);
assert.equal(confirmedQuestionExit.question_layout, undefined);

// --- Behavioral: the quick-actions guard must keep identical button DOM
// untouched, yet restore has-quick-actions after terminal navigation strips
// it (leaving keeps the cached buttons but removes the class).
const qaStart = html.indexOf('function renderTerminalActions');
const qaEnd = html.indexOf('function nextBlockedAgent', qaStart);
assert.ok(qaStart >= 0 && qaEnd > qaStart, 'quick actions functions not found');

function fakeElement() {
  const el = {
    _html: '',
    htmlWrites: 0,
    dataset: {},
    classes: new Set(),
    get innerHTML() { return this._html; },
    set innerHTML(value) { this._html = value; this.htmlWrites += 1; },
  };
  el.classList = {
    add: (...names) => names.forEach(name => el.classes.add(name)),
    remove: (...names) => names.forEach(name => el.classes.delete(name)),
    toggle: (name, force) => { if (force) el.classes.add(name); else el.classes.delete(name); },
    contains: (name) => el.classes.has(name),
  };
  return el;
}

const qaEl = fakeElement();
const viewEl = fakeElement();
let heightCalls = 0;
let qaInteraction = null;
const qaSandbox = {
  document: {getElementById: (id) => (id === 'quickActions' ? qaEl : viewEl)},
  nextBlockedAgent: () => null,
  agentStatusGroup: () => 'blocked',
  questionInteraction: () => qaInteraction,
  questionFormHtml: () => '<form class="question-form">Question form</form>',
  respondingPaneIds: new Set(),
  approvalOptions: () => ['yes', 'always', 'no'],
  approvalButtonClass: () => 'btn',
  approvalButtonLabel: (option) => option,
  escapeHtml: (value) => String(value),
  updateBottomChromeHeight: () => { heightCalls += 1; },
};
vm.runInNewContext(`
${html.slice(qaStart, qaEnd)}
this.renderTerminalActions = renderTerminalActions;
this.clearQuickActions = clearQuickActions;
`, qaSandbox);

const blockedAgent = {pane_id: 'r::w1:p1'};
qaSandbox.renderTerminalActions(blockedAgent);
assert.equal(qaEl.htmlWrites, 1);
assert.ok(qaEl.innerHTML.includes('respond(0, 3)'));
assert.ok(viewEl.classes.has('has-quick-actions'));
const renderedButtons = qaEl.innerHTML;

// Identical update: no rewrite, no height recalculation.
const heightAfterFirst = heightCalls;
qaSandbox.renderTerminalActions(blockedAgent);
assert.equal(qaEl.htmlWrites, 1, 'identical update must not rebuild buttons');
assert.equal(heightCalls, heightAfterFirst);

// Leaving the terminal strips the class but keeps the cached buttons;
// re-entering the same blocked agent must restore the class without a rebuild.
viewEl.classList.remove('active', 'has-quick-actions');
qaSandbox.renderTerminalActions(blockedAgent);
assert.ok(viewEl.classes.has('has-quick-actions'), 're-entry must restore has-quick-actions');
assert.equal(qaEl.htmlWrites, 1, 're-entry must not rebuild identical buttons');
assert.equal(qaEl.innerHTML, renderedButtons);

// Clearing resets everything and the next render rebuilds from scratch.
qaSandbox.clearQuickActions();
assert.equal(qaEl.innerHTML, '');
assert.ok(!viewEl.classes.has('has-quick-actions'));
qaSandbox.renderTerminalActions(blockedAgent);
assert.equal(qaEl.htmlWrites, 3);
assert.ok(viewEl.classes.has('has-quick-actions'));

// The same no-rebuild and class-restoration guarantees apply to the question
// overlay, not only positional approval buttons.
qaInteraction = {id: 'question-1'};
qaSandbox.renderTerminalActions(blockedAgent);
const questionOverlayWrites = qaEl.htmlWrites;
assert.ok(viewEl.classes.has('has-question'));
assert.match(qaEl.innerHTML, /question-form/);
qaSandbox.renderTerminalActions(blockedAgent);
assert.equal(qaEl.htmlWrites, questionOverlayWrites, 'identical question poll must not rebuild the overlay');
viewEl.classList.remove('has-quick-actions', 'has-question');
qaSandbox.renderTerminalActions(blockedAgent);
assert.ok(viewEl.classes.has('has-quick-actions'));
assert.ok(viewEl.classes.has('has-question'));
assert.equal(qaEl.htmlWrites, questionOverlayWrites, 'question re-entry must restore classes without rebuilding');

// --- Behavioral: Claude questions are rendered as a staged semantic form.
// Toggling checkboxes changes only the local draft; submission is handled by
// the separate protocol command after the user presses Submit.
const questionStart = html.indexOf('function questionInteraction');
const questionEnd = html.indexOf('function render()', questionStart);
assert.ok(questionStart >= 0 && questionEnd > questionStart, 'question helpers not found');
const questionAgent = {
  pane_id: 'r::w1:p2',
  interaction: {
    id: 'question-1',
    kind: 'multi_select',
    question: 'Which improvements should be included?',
    options: [
      {index: 0, label: 'Remove duplicate embed', description: 'Prevents duplicate reloads.', selected: true},
      {index: 1, label: 'Harden subscribe races', description: '', selected: false},
    ],
    other: {selected: false, text: ''},
    submit_label: 'Submit',
    can_chat: true,
    can_go_back: true,
  },
};
const questionElements = {
  questionSubmitButton: {disabled: false},
  questionOtherToggle: {checked: false},
  questionOtherInput: {value: ''},
  quickActions: {dataset: {}},
};
const questionSandbox = {
  questionDrafts: new Map(),
  respondingPaneIds: new Set(),
  activeAgent: () => questionAgent,
  normalizeInlineText: value => String(value || '').trim(),
  escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;'),
  document: {getElementById: id => questionElements[id] || null},
};
vm.runInNewContext(`
${html.slice(questionStart, questionEnd)}
this.questionInteraction = questionInteraction;
this.questionDraftFor = questionDraftFor;
this.questionFormHtml = questionFormHtml;
this.questionSubmitAllowed = questionSubmitAllowed;
this.updateQuestionOption = updateQuestionOption;
this.updateQuestionOtherSelected = updateQuestionOtherSelected;
this.updateQuestionOtherText = updateQuestionOtherText;
`, questionSandbox);

const questionForm = questionSandbox.questionFormHtml(questionAgent);
assert.match(questionForm, /<form class="question-form"/);
assert.match(questionForm, /<fieldset/);
assert.match(questionForm, /type="checkbox"[^>]*value="0" checked/);
assert.match(questionForm, /Prevents duplicate reloads\./);
assert.match(questionForm, /Chat about this/);
assert.match(questionForm, /class="question-back" type="button" onclick="navigateQuestionPrevious\(\)"/);
questionSandbox.respondingPaneIds.add(questionAgent.pane_id);
assert.match(
  questionSandbox.questionFormHtml(questionAgent),
  /class="question-back"[^>]* disabled/,
  'Previous must lock while a question command is in flight',
);
questionSandbox.respondingPaneIds.clear();
questionSandbox.updateQuestionOption(1, true);
let stagedDraft = questionSandbox.questionDraftFor(questionAgent);
assert.deepEqual([...stagedDraft.selected], [0, 1]);
questionSandbox.updateQuestionOtherText('Back-port all changes');
stagedDraft = questionSandbox.questionDraftFor(questionAgent);
assert.equal(stagedDraft.otherSelected, true);
assert.equal(stagedDraft.otherText, 'Back-port all changes');

const firstQuestionInteraction = questionAgent.interaction;
questionAgent.interaction = {
  ...firstQuestionInteraction,
  id: 'question-2',
  question: 'Which devices should be included?',
  can_go_back: true,
};
questionSandbox.questionDraftFor(questionAgent);
questionAgent.interaction = firstQuestionInteraction;
stagedDraft = questionSandbox.questionDraftFor(questionAgent);
assert.deepEqual([...stagedDraft.selected], [0, 1], 'returning must restore the prior draft');
assert.equal(stagedDraft.otherText, 'Back-port all changes');

// Codex Plan-mode questions use the same overlay, with a valid empty
// "None of the above" choice and an optional notes field.
questionAgent.interaction = {
  id: 'codex-question-1',
  kind: 'single_select',
  question: 'Where should the adapter boundary sit?',
  options: [
    {index: 0, label: 'Domain port', description: 'Transport-agnostic contracts.', selected: false},
    {index: 1, label: 'Protocol boundary', description: 'Keep relay-shaped logic.', selected: false},
  ],
  other: {
    selected: false,
    text: '',
    label: 'None of the above',
    placeholder: 'Optional notes',
    allow_empty: true,
  },
  submit_label: 'Next',
  can_chat: false,
  can_go_back: false,
};
const codexQuestionForm = questionSandbox.questionFormHtml(questionAgent);
assert.match(codexQuestionForm, /type="radio"[^>]*value="0"/);
assert.match(codexQuestionForm, /None of the above/);
assert.match(codexQuestionForm, /placeholder="Optional notes"/);
assert.match(codexQuestionForm, />Next<\/button>/);
assert.doesNotMatch(codexQuestionForm, /Chat about this/);
questionSandbox.updateQuestionOtherSelected(true);
const codexDraft = questionSandbox.questionDraftFor(questionAgent);
assert.equal(codexDraft.otherSelected, true);
assert.equal(
  questionSandbox.questionSubmitAllowed(questionAgent.interaction, codexDraft),
  true,
  'Codex None of the above must be valid without notes',
);

// --- Behavioral: the composer must lock while the active agent waits for
// approval (free text is meaningless against an approval menu) and unlock
// once the agent moves on.
const composerStart = html.indexOf('function updateComposerState');
const composerEnd = html.indexOf('function sendKey', composerStart);
assert.ok(composerStart >= 0 && composerEnd > composerStart, 'updateComposerState not found');

const inputEl = {disabled: false, placeholder: 'Type…', value: ''};
const sendEl = {disabled: true};
const attachEl = {disabled: false};
const fieldEl = {classes: new Set()};
fieldEl.classList = {
  contains: name => fieldEl.classes.has(name),
  toggle: (name, force) => { if (force) fieldEl.classes.add(name); else fieldEl.classes.delete(name); },
};
let composerAgent = {pane_id: 'r::w1:p1', status: 'blocked'};
const composerDocument = {
  activeElement: inputEl,
  getElementById: id => ({termInput: inputEl, sendButton: sendEl, attachButton: attachEl, composerField: fieldEl}[id]),
};
const composerSandbox = {
  document: composerDocument,
  activeAgent: () => composerAgent,
  agentStatusGroup: (agent) => agent.status,
  composerPromptText: (input) => input.value,
  composerHasFocus: () => composerDocument.activeElement === inputEl,
};
vm.runInNewContext(`
${html.slice(composerStart, composerEnd)}
this.updateComposerState = updateComposerState;
`, composerSandbox);

composerSandbox.updateComposerState();
assert.equal(inputEl.disabled, false, 'approval must not disable a focused composer or reset its IME');
assert.equal(attachEl.disabled, true);
assert.equal(sendEl.disabled, true);
assert.match(inputEl.placeholder, /approval/i);

composerDocument.activeElement = null;
composerSandbox.updateComposerState();
assert.equal(inputEl.disabled, true, 'composer may lock after the keyboard releases it');
assert.ok(fieldEl.classes.has('awaiting-approval'));

composerAgent = {pane_id: 'r::w1:p1', status: 'working'};
inputEl.value = 'hello';
composerSandbox.updateComposerState();
assert.equal(inputEl.disabled, false, 'composer must unlock when no longer blocked');
assert.ok(!fieldEl.classes.has('awaiting-approval'));
assert.equal(attachEl.disabled, false);
assert.equal(sendEl.disabled, false);
assert.equal(inputEl.placeholder, 'Type…');

console.log('ANSI terminal renderer tests passed');
