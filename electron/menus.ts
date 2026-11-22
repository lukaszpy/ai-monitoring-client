import type { MenuItemConstructorOptions } from 'electron';
import { translate, type Language, type MessageKey } from '../src/shared/i18n.js';

export function applicationMenu(language: Language, platform: NodeJS.Platform): MenuItemConstructorOptions[] {
  const t = (key: MessageKey) => translate(language, key);
  const mac = platform === 'darwin';
  const items: MenuItemConstructorOptions[] = [];
  if (mac) items.push({ label: 'AI Monitoring', submenu: [
    { label: t('O AI Monitoring'), role: 'about' }, { type: 'separator' },
    { label: t('Ukryj AI Monitoring'), role: 'hide' }, { label: t('Ukryj pozostałe'), role: 'hideOthers' },
    { label: t('Pokaż wszystkie okna'), role: 'unhide' }, { type: 'separator' },
    { label: t('Zakończ AI Monitoring'), role: 'quit' },
  ] });
  items.push(
    { label: t('Plik'), submenu: [
      { label: t('Zamknij okno'), role: 'close' },
      ...(!mac ? [{ type: 'separator' as const }, { label: t('Zakończ AI Monitoring'), role: 'quit' as const }] : []),
    ] },
    { label: t('Edycja'), submenu: [
      { label: t('Cofnij'), role: 'undo' }, { label: t('Ponów'), role: 'redo' }, { type: 'separator' },
      { label: t('Wytnij'), role: 'cut' }, { label: t('Kopiuj'), role: 'copy' }, { label: t('Wklej'), role: 'paste' },
      { label: t('Zaznacz wszystko'), role: 'selectAll' },
    ] },
    { label: t('Widok'), submenu: [{ label: t('Pełny ekran'), role: 'togglefullscreen' }] },
    { label: t('Okno'), submenu: [{ label: t('Minimalizuj'), role: 'minimize' }, { label: t('Powiększ okno'), role: 'zoom' }] },
  );
  return items;
}

export function trayMenu(language: Language, callbacks: { show: () => void; refresh: () => void; quit: () => void }): MenuItemConstructorOptions[] {
  return [
    { label: translate(language, 'Pokaż mapę agentów'), click: callbacks.show },
    { label: translate(language, 'Odśwież dane'), click: callbacks.refresh }, { type: 'separator' },
    { label: translate(language, 'Zakończ AI Monitoring'), click: callbacks.quit },
  ];
}
