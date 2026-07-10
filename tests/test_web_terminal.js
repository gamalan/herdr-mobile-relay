const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('web/index.html', 'utf8');
assert.match(html, /\.term-content \{[^}]*padding: 10px 16px/);
assert.match(html, /\.ansi-line \{[^}]*overflow: hidden/);
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
this.ansiLineBackgrounds = ansiLineBackgrounds;
this.terminalHtml = terminalHtml;
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

const prompt = sandbox.terminalHtml([
  '\x1b[48;2;61;64;64m› First prompt paragraph   \x1b[0m',
  '\r',
  '\x1b[48;2;61;64;64mSecond paragraph that wraps on a phone   \x1b[0m',
].join('\n'));
assert.equal(sandbox.ansiLineBackground('\x1b[48;2;61;64;64m› Prompt\x1b[0m'), 'rgb(61,64,64)');
assert.match(prompt, /class="ansi-line ansi-line-background" style="background-color:rgb\(61,64,64\)"/);
assert.equal((prompt.match(/class="ansi-line ansi-line-background"/g) || []).length, 3);
assert.doesNotMatch(prompt, /paragraph {3}/);

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

const nonCodexWhite = sandbox.terminalHtml('\x1b[107mWhite row\x1b[0m');
assert.match(nonCodexWhite, /background-color:#fff/);

const inlineWhite = sandbox.terminalHtml('Normal text \x1b[107mwhite highlight\x1b[0m', true);
assert.match(inlineWhite, /background-color:#fff/);
assert.doesNotMatch(inlineWhite, /ansi-line-background/);

console.log('ANSI terminal renderer tests passed');
