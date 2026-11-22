import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { configuredDefaultSources, defaultSources, settingsFromDisk, standardSourceDirectories } from '../electron/settings.js';

test('standard source directories follow the supplied system home on macOS, Windows and Linux', () => {
  for (const [platform, home, paths] of [
    ['darwin', '/Users/Ada Kowalska', path.posix],
    ['win32', 'D:\\Profiles\\Łukasz Nowak', path.win32],
    ['linux', '/mnt/home/alex', path.posix],
  ] as const) {
    const defaults = standardSourceDirectories(home, platform);
    assert.deepEqual(defaults, {
      codex: paths.join(home, '.codex'),
      'claude-code': paths.join(home, '.claude'),
      'gemini-cli': paths.join(home, '.gemini'),
    });
  }
});

test('fresh settings obtain every source from the actual OS home without a configured username', () => {
  const sources = configuredDefaultSources({});
  assert.deepEqual(sources.map(source => source.directory), ['.codex', '.claude', '.gemini'].map(folder => path.join(homedir(), folder)));
  const settings = settingsFromDisk(null, sources);
  assert.deepEqual(settings.sources, sources);
  assert.ok(settings.sources.every(source => source.enabled && source.contextLimitOverride === null));
});

test('overriding one runtime does not relocate the other runtimes beside its directory', () => {
  const custom = path.resolve('test-custom-codex-home');
  const sources = configuredDefaultSources({ CODEX_HOME: custom });
  assert.equal(sources[0].directory, custom);
  assert.equal(sources[1].directory, path.join(homedir(), '.claude'));
  assert.equal(sources[2].directory, path.join(homedir(), '.gemini'));
  assert.equal(defaultSources(custom)[1].directory, path.join(homedir(), '.claude'));
});

test('explicit per-runtime environment paths take precedence, while empty overrides use system defaults', () => {
  const claude = path.resolve('my-claude-data'), gemini = path.resolve('my-gemini-data');
  const sources = configuredDefaultSources({ CODEX_HOME: '', CLAUDE_CONFIG_DIR: claude, AI_MONITORING_GEMINI_HOME: gemini });
  assert.equal(sources[0].directory, path.join(homedir(), '.codex'));
  assert.equal(sources[1].directory, claude);
  assert.equal(sources[2].directory, gemini);
});

test('saved custom directories and general preferences survive without modifying the system defaults', () => {
  const defaults = configuredDefaultSources({});
  const original = structuredClone(defaults);
  const custom = defaults.map(source => ({ ...source, directory: path.resolve('custom', source.runtime), contextLimitOverride: 200000 }));
  const saved = { sources: custom, language: 'fr', showCompleted: false };
  const settings = settingsFromDisk(saved, defaults);
  assert.deepEqual(settings.sources, custom);
  assert.equal(settings.language, 'fr'); assert.equal(settings.showCompleted, false);
  settings.sources[0].directory = path.resolve('changed-after-load');
  assert.deepEqual(defaults, original);
  assert.deepEqual(saved.sources, custom);
  const fresh = settingsFromDisk(null, defaults);
  fresh.sources[0].directory = path.resolve('changed-fresh-default');
  assert.deepEqual(defaults, original);
});

test('legacy Codex home migration retains independent OS defaults for Claude and Gemini', () => {
  const defaults = configuredDefaultSources({});
  const legacyHome = path.resolve('old-codex-home');
  const settings = settingsFromDisk({ codexHome: legacyHome }, defaults);
  assert.equal(settings.sources[0].directory, legacyHome);
  assert.equal(settings.sources[1].directory, path.join(homedir(), '.claude'));
  assert.equal(settings.sources[2].directory, path.join(homedir(), '.gemini'));
  assert.equal(defaults[0].directory, path.join(homedir(), '.codex'));
});
