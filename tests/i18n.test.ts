import assert from 'node:assert/strict';
import test from 'node:test';
import { applicationMenu, trayMenu } from '../electron/menus.js';
import { defaultSources, settingsFromDisk, validateSettingsPatch } from '../electron/settings.js';
import { ago, compactNumber, dateTime, fullNumber } from '../src/lib/format.ts';
import { LANGUAGES, MESSAGES, localizeMessage, pluralUnit, resolveLanguage, translate, type MessageKey } from '../src/shared/i18n.js';

test('every message has all five languages with the same interpolation placeholders', () => {
  for (const key of Object.keys(MESSAGES) as MessageKey[]) {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    const expected = placeholders(key);
    for (const language of LANGUAGES) {
      const text = translate(language, key);
      assert.ok(text.trim(), `${language}: ${key}`);
      assert.deepEqual(placeholders(text), expected, `${language}: ${key}`);
      assert.doesNotMatch(text, /undefined|\[object Object\]/);
    }
  }
});

test('all supported language selections are validated and older settings keep Polish by default', () => {
  for (const language of LANGUAGES) {
    assert.equal(resolveLanguage(language), language);
    assert.equal(settingsFromDisk({ language, showCompleted: false }, defaultSources('/codex')).language, language);
    assert.deepEqual(validateSettingsPatch({ language }), { language });
  }
  assert.equal(settingsFromDisk({ codexHome: '/existing', showCompleted: false }, defaultSources('/default')).language, 'pl');
  assert.equal(settingsFromDisk({ language: 'not-a-language' }, defaultSources('/codex')).language, 'pl');
  assert.equal(settingsFromDisk(null, defaultSources('/codex')).language, 'pl');
  assert.equal(settingsFromDisk({ language: 'en', codexHome: '../../outside' }, defaultSources('/codex')).sources[0].directory, '/codex');
  for (const invalid of ['es', 'EN', 'en-GB', '', '<script>', null, 123]) {
    assert.equal(resolveLanguage(invalid), 'pl');
    assert.throws(() => validateSettingsPatch({ language: invalid }));
  }
  assert.deepEqual(validateSettingsPatch({ codexHome: '/not-an-allowed-patch', language: 'de' }), { language: 'de' });
});

test('interpolation preserves literal session IDs and paths without evaluating their contents', () => {
  const id = '<script>{count} $HOME</script>';
  const text = translate('en', 'Utworzono nową sesję: {id}. Wybierz ją w Codex, aby rozpocząć pracę.', { id });
  assert.ok(text.includes(id));
  assert.equal(localizeMessage('de', 'Nie można odczytać katalogu C:\\Projekte\\źródła.'), 'Verzeichnis C:\\Projekte\\źródła kann nicht gelesen werden.');
  assert.equal(localizeMessage('fr', 'Pominięto uszkodzony rekord JSONL.'), 'Un enregistrement JSONL invalide a été ignoré.');
  assert.equal(localizeMessage('ru', 'upstream_custom_error: do not translate me'), 'upstream_custom_error: do not translate me');
});

test('Polish and Russian plural forms handle 1, 2, 5, 21 and 22 correctly', () => {
  assert.deepEqual([1, 2, 5, 21, 22].map(n => pluralUnit('pl', 'agents', n)), ['agent', 'agenci', 'agentów', 'agentów', 'agenci']);
  assert.deepEqual([1, 2, 5, 21, 22].map(n => pluralUnit('ru', 'sessions', n)), ['сессия', 'сессии', 'сессий', 'сессия', 'сессии']);
  assert.equal(pluralUnit('en', 'nodes', 1), 'node');
  assert.equal(pluralUnit('de', 'measurements', 2), 'Messungen');
  assert.equal(pluralUnit('fr', 'nodes', 2), 'nœuds');
});

test('numbers, compact units, dates and relative time follow the selected locale', () => {
  assert.equal(fullNumber(12345, 'en'), '12,345');
  assert.equal(fullNumber(12345, 'de'), '12.345');
  assert.equal(fullNumber(12345, 'fr').replace(/\s/g, ' '), '12 345');
  assert.equal(fullNumber(12345, 'ru').replace(/\s/g, ' '), '12 345');
  assert.match(compactNumber(199500, 'en'), /199\.5K/);
  assert.match(compactNumber(199500, 'ru'), /199,5/);
  assert.match(dateTime('2026-11-18T10:30:00Z', 'en'), /Nov/);
  assert.match(dateTime('2026-11-18T10:30:00Z', 'ru'), /нояб/);
  assert.equal(dateTime('broken', 'fr'), '—');
  assert.equal(ago(null, 'en'), 'no measurement');
  assert.equal(ago(new Date().toISOString(), 'ru'), 'только что');
  const fiveMinutesAgo = new Date(Date.now() - 300000).toISOString();
  assert.match(ago(fiveMinutesAgo, 'de'), /^vor 5/);
  assert.match(ago(fiveMinutesAgo, 'fr'), /^il y a 5/);
});

test('native menus change language while keeping the same actions and platform roles', () => {
  const expectedFile = { pl: 'Plik', en: 'File', de: 'Datei', fr: 'Fichier', ru: 'Файл' };
  for (const language of LANGUAGES) {
    const menu = applicationMenu(language, 'darwin');
    assert.equal(menu[1].label, expectedFile[language]);
    const win = applicationMenu(language, 'win32');
    assert.equal(win[0].label, expectedFile[language]);
    const tray = trayMenu(language, { show() {}, refresh() {}, quit() {} });
    assert.equal(tray.length, 4);
    assert.equal(tray[0].label, translate(language, 'Pokaż mapę agentów'));
    assert.equal(tray[3].label, translate(language, 'Zakończ AI Monitoring'));
    assert.equal(typeof tray[0].click, 'function');
  }
});
