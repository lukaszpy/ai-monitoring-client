import { Plus, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { COST_TOKEN_KINDS, type ModelPrice, type RuntimeId } from '../shared/types';
import { builtInModelPrices, BUILT_IN_PRICE_DATE } from '../shared/pricing-catalog';
import { useI18n } from '../i18n';

export const RATE_LABELS = { input: 'Wejście bez cache', cachedInput: 'Odczyt cache', output: 'Wyjście i rozumowanie', cacheWrite: 'Zapis cache — brak TTL', cacheWrite5m: 'Zapis cache 5 min', cacheWrite1h: 'Zapis cache 1 godz.' } as const;
type Draft = { model: string; rates: Record<typeof COST_TOKEN_KINDS[number], string> };
const draftPrice = (price?: ModelPrice): Draft => ({ model: price?.model ?? '', rates: Object.fromEntries(COST_TOKEN_KINDS.map(kind => [kind, price?.rates[kind] === null || price?.rates[kind] === undefined ? '' : String(price.rates[kind])])) as Draft['rates'] });

export function ModelPriceSettings({ prices, models, runtime, useBuiltInPrices, disabled, onSave, onBuiltInChange }: { prices: ModelPrice[]; models: string[]; runtime: RuntimeId; useBuiltInPrices: boolean; disabled: boolean; onSave: (prices: ModelPrice[]) => Promise<void>; onBuiltInChange: (enabled: boolean) => Promise<void> }) {
  const { t, language } = useI18n();
  const defaults = builtInModelPrices(runtime);
  const listId = useId();
  const [rows, setRows] = useState<Draft[]>(() => prices.map(draftPrice));
  const value: ModelPrice[] = rows.map(row => ({ model: row.model.trim(), rates: Object.fromEntries(COST_TOKEN_KINDS.map(kind => [kind, row.rates[kind].trim() === '' ? null : Number(row.rates[kind])])) as ModelPrice['rates'] }));
  const valid = new Set(value.map(row => row.model)).size === value.length && value.every(row => row.model.length > 0 && row.model.length <= 200 && Object.values(row.rates).every(rate => rate === null || Number.isFinite(rate) && rate >= 0 && rate <= 1e9));
  const dirty = JSON.stringify(value) !== JSON.stringify(prices);
  const update = (index: number, patch: Partial<Draft>) => setRows(previous => previous.map((row, i) => i === index ? { ...row, ...patch } : row));
  return <details className="model-price-settings"><summary>{t('Stawki modeli · USD / 1 mln tokenów')}</summary>
    {defaults.length > 0 && <div className="built-in-prices">
      <label className="source-enabled"><span>{t('Używaj wbudowanych stawek Codex')}</span><input type="checkbox" checked={useBuiltInPrices} disabled={disabled} onChange={event => { void onBuiltInChange(event.target.checked); }} /></label>
      <p className="source-hint">{t('Cennik API Standard z {date}. To ekwiwalent kosztu tokenów, nie rozliczenie abonamentu. Własny wpis zastępuje wszystkie stawki danego modelu.', { date: BUILT_IN_PRICE_DATE })}</p>
      <div className="built-in-price-table"><table><caption>{t('Wbudowane stawki · USD / 1 mln tokenów')}</caption><thead><tr><th>{t('Dokładna nazwa modelu')}</th>{(['input', 'cachedInput', 'cacheWrite', 'output'] as const).map(kind => <th key={kind}>{t(RATE_LABELS[kind])}</th>)}</tr></thead><tbody>{defaults.map(price => <tr key={price.model}><th scope="row">{price.model}</th>{(['input', 'cachedInput', 'cacheWrite', 'output'] as const).map(kind => <td key={kind}>{price.rates[kind]?.toLocaleString(language)}</td>)}</tr>)}</tbody></table></div>
      <p className="source-hint">{t('Dla wejścia powyżej 272 tys. tokenów: stawki wejścia i cache ×2, wyjścia ×1,5. Estymacja nie uwzględnia trybów Fast, Flex, rabatów ani opłat narzędzi.')}</p>
    </div>}
    <p className="source-hint">{t('Wpisz własne stawki dla dokładnej nazwy modelu. Puste pole oznacza brak stawki, a 0 oznacza stawkę zerową. Cennik przelicza całe dostępne zużycie.')}</p>
    <datalist id={listId}>{models.map(model => <option key={model} value={model} />)}</datalist>
    {rows.map((row, index) => <fieldset className="model-price-row" key={index} disabled={disabled}>
      <div className="model-price-heading"><input aria-label={t('Model w cenniku {index}', { index: index + 1 })} list={listId} placeholder={t('Dokładna nazwa modelu')} value={row.model} onChange={event => update(index, { model: event.target.value })} /><button className="icon-button" aria-label={t('Usuń stawkę modelu {index}', { index: index + 1 })} onClick={() => setRows(previous => previous.filter((_, i) => i !== index))}><Trash2 size={13} /></button></div>
      <div className="model-rate-grid">{COST_TOKEN_KINDS.map(kind => <label key={kind}><span>{t(RATE_LABELS[kind])}</span><input type="number" min="0" max="1000000000" step="any" placeholder="—" aria-label={t('{kind} · model {index}', { kind: t(RATE_LABELS[kind]), index: index + 1 })} value={row.rates[kind]} onChange={event => update(index, { rates: { ...row.rates, [kind]: event.target.value } })} /></label>)}</div>
    </fieldset>)}
    {!valid && <p className="inline-warning" role="alert">{t('Nieprawidłowe stawki modeli.')}</p>}
    <div className="price-buttons"><button className="secondary-button" disabled={disabled || rows.length >= 100} onClick={() => setRows(previous => [...previous, draftPrice()])}><Plus size={13} />{t('Dodaj model do cennika')}</button><button className="secondary-button" disabled={disabled || !valid || !dirty} onClick={() => { void onSave(value); }}>{t('Zapisz stawki')}</button></div>
  </details>;
}
