import { Bell, BellOff } from 'lucide-react';
import { useState } from 'react';
import type { ContextAlertSettings } from '../shared/types';
import { useI18n } from '../i18n';

interface Props {
  sourceId: string;
  settings: ContextAlertSettings;
  disabled: boolean;
  supported: boolean;
  onSave: (settings: ContextAlertSettings) => Promise<void>;
}

/** The caller keys this editor by saved values, so polling never discards an unsaved draft. */
export function SourceAlertSettings({ sourceId, settings, disabled, supported, onSave }: Props) {
  const { t } = useI18n();
  const [warn, setWarn] = useState(String(settings.warn.threshold));
  const [critical, setCritical] = useState(String(settings.critical.threshold));
  const [warnNotification, setWarnNotification] = useState(settings.warn.systemNotification);
  const [criticalNotification, setCriticalNotification] = useState(settings.critical.systemNotification);
  const value: ContextAlertSettings = { warn: { threshold: Number(warn), systemNotification: warnNotification }, critical: { threshold: Number(critical), systemNotification: criticalNotification } };
  const valid = [value.warn.threshold, value.critical.threshold].every(threshold => Number.isInteger(threshold) && threshold >= 1 && threshold <= 100) && value.warn.threshold < value.critical.threshold;
  const dirty = JSON.stringify(value) !== JSON.stringify(settings);
  return <fieldset className="source-alert-settings" data-testid={`alerts-${sourceId}`} disabled={disabled}>
    <legend><Bell size={13} />{t('Powiadomienia o kontekście')}</legend>
    <p className="source-hint">{t('Ustaw dwa progi dla wszystkich sesji i subagentów tego źródła. Powiadomienia zapiszesz przyciskiem poniżej.')}</p>
    {(['warn', 'critical'] as const).map(level => {
      const isWarn = level === 'warn';
      const checked = isWarn ? warnNotification : criticalNotification;
      return <div className={`alert-rule alert-rule-${level}`} key={level}>
        <label className="alert-threshold"><strong>{isWarn ? 'Warn' : 'Critical'}</strong><span><input type="number" min="1" max="100" step="1" aria-label={t('Próg {level} dla {id}', { level: isWarn ? 'Warn' : 'Critical', id: sourceId })} value={isWarn ? warn : critical} onChange={event => (isWarn ? setWarn : setCritical)(event.target.value)} />%</span></label>
        <label className="alert-system-notification">{checked ? <Bell size={12} /> : <BellOff size={12} />}<span>{t('Powiadomienie systemowe')}</span><input type="checkbox" aria-label={t('Powiadomienie systemowe {level} dla {id}', { level: isWarn ? 'Warn' : 'Critical', id: sourceId })} checked={checked} disabled={!supported} onChange={event => (isWarn ? setWarnNotification : setCriticalNotification)(event.target.checked)} /></label>
      </div>;
    })}
    {!valid && <p className="inline-warning" role="alert">{t('Nieprawidłowe progi powiadomień. Wymagane: 1–100% i Warn < Critical.')}</p>}
    <div className="alert-settings-footer"><p className="source-hint">{t('Alert dotyczy nowego przekroczenia progu. Kolejne skany tego samego pomiaru go nie powtarzają.')}</p><button type="button" className="secondary-button" disabled={!valid || !dirty} onClick={() => { void onSave(value); }}>{t('Zapisz powiadomienia')}</button></div>
  </fieldset>;
}
