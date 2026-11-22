import { contextColor } from '../lib/format';
import { fullNumber } from '../lib/format';
import { useI18n } from '../i18n';

export function Gauge({ percent, size = 96, stroke = 5, label = true, estimated = false }: { percent: number | null; size?: number; stroke?: number; label?: boolean; estimated?: boolean }) {
  const { t, language } = useI18n();
  const radius = (size - stroke * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const color = contextColor(percent);
  return <div className="gauge" style={{ width: size, height: size, color }} role="img" aria-label={percent === null ? t("Brak pomiaru kontekstu") : `${estimated ? `${t('Szacowany')} · ` : ''}${t('Kontekst: {percent}%', { percent: Math.round(percent) })}`}>
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeOpacity=".11" strokeWidth={stroke} />
      {percent !== null && <circle className="gauge-value" cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - Math.min(100, Math.max(0, percent)) / 100)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />}
    </svg>
    <div className="gauge-center"><strong>{estimated && percent !== null && <span>≈</span>}{percent === null ? '—' : fullNumber(Math.round(percent), language)}{percent !== null && <span>%</span>}</strong>{label && <small>{t("kontekstu")}</small>}</div>
  </div>;
}
