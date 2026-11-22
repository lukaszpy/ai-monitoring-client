import assert from 'node:assert/strict';
import test from 'node:test';
import { ContextAlertMonitor } from '../electron/context-alerts.js';
import { createSession } from '../electron/session-parser.js';
import { defaultSources, settingsFromDisk, validateContextAlerts, validateSettingsPatch } from '../electron/settings.js';
import { defaultContextAlerts, type AgentSession, type AgentSourceConfig } from '../src/shared/types.js';

const start = Date.parse('2026-11-19T12:00:00Z');
const enabled = () => ({ warn: { threshold: 70, systemNotification: true }, critical: { threshold: 90, systemNotification: true } });
const source = (id = 'codex'): AgentSourceConfig => ({ ...defaultSources()[0], id, contextAlerts: enabled() });
function session(percent: number | null, now: number, extra: Partial<AgentSession> = {}): AgentSession {
  return { ...createSession('file'), id: 'session', sourceId: 'codex', externalId: 'native-id', runtime: 'codex',
    contextPercent: percent, contextTokens: percent === null ? null : percent * 1000, contextLimit: 100000,
    contextQuality: percent === null ? 'unavailable' : 'reported', measuredAt: percent === null ? null : new Date(now).toISOString(), ...extra };
}

test('existing measurements become a baseline and fresh crossings emit each level once', () => {
  const detector = new ContextAlertMonitor(), sources = [source()];
  assert.deepEqual(detector.evaluate([session(40, start)], sources, start), []);
  assert.deepEqual(detector.evaluate([session(70, start + 1000)], sources, start + 1000).map(alert => alert.level), ['warn']);
  assert.deepEqual(detector.evaluate([session(75, start + 2000)], sources, start + 2000), []);
  assert.deepEqual(detector.evaluate([session(90, start + 3000)], sources, start + 3000).map(alert => alert.level), ['critical']);
  assert.deepEqual(detector.evaluate([session(95, start + 4000)], sources, start + 4000), []);
  assert.deepEqual(detector.evaluate([session(95, start + 4000)], sources, start + 5000), []);
});

test('a jump across both thresholds sends the highest enabled level only', () => {
  for (const [warn, critical, expected] of [[true, true, ['critical']], [true, false, ['warn']], [false, true, ['critical']], [false, false, []]] as const) {
    const detector = new ContextAlertMonitor(), config = source();
    config.contextAlerts.warn.systemNotification = warn; config.contextAlerts.critical.systemNotification = critical;
    detector.evaluate([session(30, start)], [config], start);
    assert.deepEqual(detector.evaluate([session(99, start + 1000)], [config], start + 1000).map(alert => alert.level), expected);
  }
});

test('hysteresis prevents oscillation spam and independently re-arms each level', () => {
  const detector = new ContextAlertMonitor(), sources = [source()];
  let tick = start;
  const observe = (percent: number) => { tick += 1000; return detector.evaluate([session(percent, tick)], sources, tick); };
  observe(40); assert.equal(observe(71).length, 1);
  observe(69); assert.equal(observe(72).length, 0);
  observe(65); assert.deepEqual(observe(73).map(alert => alert.level), ['warn']);
  assert.deepEqual(observe(90).map(alert => alert.level), ['critical']);
  observe(86); assert.equal(observe(91).length, 0);
  observe(85); assert.deepEqual(observe(92).map(alert => alert.level), ['critical']);
});

test('small thresholds can re-arm after dropping to half their configured value', () => {
  const detector = new ContextAlertMonitor(), config = source();
  config.contextAlerts = { warn: { threshold: 1, systemNotification: true }, critical: { threshold: 2, systemNotification: true } };
  detector.evaluate([session(0, start)], [config], start);
  assert.equal(detector.evaluate([session(2, start + 1000)], [config], start + 1000).length, 1);
  detector.evaluate([session(0, start + 2000)], [config], start + 2000);
  assert.equal(detector.evaluate([session(2, start + 3000)], [config], start + 3000).length, 1);
});

test('startup archives and repeated high readings do not generate notifications', () => {
  const detector = new ContextAlertMonitor(), sources = [source()];
  assert.deepEqual(detector.evaluate([session(95, start - 3600000)], sources, start), []);
  assert.deepEqual(detector.evaluate([session(96, start + 1000)], sources, start + 1000), []);
  // A newly discovered archive also cannot notify.
  assert.deepEqual(detector.evaluate([session(98, start - 3600000, { id: 'archive' })], sources, start + 2000), []);
});

test('new sessions and new subagents created after the baseline can notify on their first measurement', () => {
  const detector = new ContextAlertMonitor(), sources = [source()];
  detector.evaluate([], sources, start);
  const alerts = detector.evaluate([session(91, start + 1000, { id: 'new-child', parentId: 'parent', lineage: 'parent', source: 'subagent' })], sources, start + 1000);
  assert.equal(alerts.length, 1); assert.equal(alerts[0].session.id, 'new-child'); assert.equal(alerts[0].level, 'critical');
});

test('threshold and checkbox changes baseline existing data, while unrelated source edits do not reset latches', () => {
  const detector = new ContextAlertMonitor(), config = source();
  detector.evaluate([session(40, start)], [config], start);
  detector.evaluate([session(75, start + 1000)], [config], start + 1000);
  const changed = { ...config, contextAlerts: { ...config.contextAlerts, critical: { threshold: 80, systemNotification: true } } };
  assert.deepEqual(detector.evaluate([session(85, start + 2000)], [changed], start + 2000), []);
  assert.deepEqual(detector.evaluate([session(90, start + 3000)], [{ ...changed }], start + 3000), []);
  const toggled = structuredClone(changed); toggled.contextAlerts.warn.systemNotification = false;
  assert.deepEqual(detector.evaluate([session(95, start + 4000)], [toggled], start + 4000), []);
});

test('each source has its own thresholds and enabling a disabled source does not replay historical alerts', () => {
  const detector = new ContextAlertMonitor(), first = source('first'), second = source('second');
  second.contextAlerts.warn.threshold = 80;
  const sessions = (percent: number, now: number) => [session(percent, now, { sourceId: 'first' }), session(percent, now, { sourceId: 'second' })];
  detector.evaluate(sessions(30, start), [first, second], start);
  let alerts = detector.evaluate(sessions(75, start + 1000), [first, second], start + 1000);
  assert.deepEqual(alerts.map(alert => alert.source.id), ['first']);
  alerts = detector.evaluate(sessions(81, start + 2000), [first, second], start + 2000);
  assert.deepEqual(alerts.map(alert => alert.source.id), ['second']);
  assert.deepEqual(detector.evaluate(sessions(95, start + 3000), [{ ...first, enabled: false }], start + 3000), []);
  assert.deepEqual(detector.evaluate(sessions(96, start + 4000), [first], start + 4000), []);
});

test('missing usage never fabricates a crossing or re-arms an already alerted session', () => {
  const detector = new ContextAlertMonitor(), config = source();
  detector.evaluate([session(40, start)], [config], start);
  detector.evaluate([session(95, start + 1000)], [config], start + 1000);
  assert.deepEqual(detector.evaluate([session(null, start + 2000)], [config], start + 2000), []);
  assert.deepEqual(detector.evaluate([session(96, start + 3000)], [config], start + 3000), []);
});

test('compaction re-arms levels after the next actual usage measurement', () => {
  const detector = new ContextAlertMonitor(), config = source();
  detector.evaluate([session(95, start)], [config], start);
  assert.deepEqual(detector.evaluate([session(null, start + 1000, { compactions: 1 })], [config], start + 1000), []);
  assert.deepEqual(detector.evaluate([session(80, start + 2000, { compactions: 1 })], [config], start + 2000).map(alert => alert.level), ['warn']);
});

test('stale, future, malformed, out-of-order and unavailable measurements cannot notify', () => {
  for (const patch of [
    { measuredAt: new Date(start - 3600000).toISOString() }, { measuredAt: new Date(start - 1000).toISOString() }, { measuredAt: new Date(start + 3600000).toISOString() },
    { measuredAt: null }, { measuredAt: 'broken' }, { contextPercent: Number.NaN }, { contextPercent: Infinity },
    { contextQuality: 'unavailable' as const },
  ]) {
    const detector = new ContextAlertMonitor(), config = source();
    detector.evaluate([session(30, start)], [config], start);
    assert.deepEqual(detector.evaluate([session(95, start + 1000, patch)], [config], start + 1000), [], JSON.stringify(patch));
  }
});

test('estimated usage is eligible and preserves its quality for the notification body', () => {
  const detector = new ContextAlertMonitor(), config = source();
  detector.evaluate([session(30, start)], [config], start);
  const alerts = detector.evaluate([session(75, start + 1000, { contextQuality: 'estimated' })], [config], start + 1000);
  assert.equal(alerts[0].session.contextQuality, 'estimated'); assert.equal(alerts[0].threshold, 70);
});

test('alert migration preserves existing source paths, limits, enabled state and general preferences', () => {
  const defaults = defaultSources();
  const { contextAlerts: _legacy, ...legacy } = { ...defaults[0], directory: `${defaults[0].directory}-custom`, enabled: false, contextLimitOverride: 250000 };
  const settings = settingsFromDisk({ language: 'de', showCompleted: false, sources: [legacy] }, defaults);
  assert.equal(settings.sources[0].directory, legacy.directory);
  assert.equal(settings.sources[0].enabled, false); assert.equal(settings.sources[0].contextLimitOverride, 250000);
  assert.equal(settings.language, 'de'); assert.equal(settings.showCompleted, false);
  assert.deepEqual(settings.sources[0].contextAlerts, defaultContextAlerts());
});

test('thresholds require ordered integers from 1 to 100 and independent boolean toggles', () => {
  const valid = enabled(); assert.deepEqual(validateContextAlerts(valid), valid);
  for (const bad of [null, [], {}, { ...valid, warn: null },
    ...[0, -1, 90, 100, 101, 1.5, Number.NaN, '70'].map(threshold => ({ ...valid, warn: { threshold, systemNotification: false } })),
    { ...valid, critical: { threshold: 90, systemNotification: 'yes' } },
  ]) assert.throws(() => validateContextAlerts(bad));
  assert.deepEqual(validateContextAlerts(undefined), defaultContextAlerts());
  const config = source(); config.contextAlerts.critical.systemNotification = false;
  const patch = validateSettingsPatch({ sources: [config] }); assert.deepEqual(patch.sources?.[0].contextAlerts, config.contextAlerts);
});
