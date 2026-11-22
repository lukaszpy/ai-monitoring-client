import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { localizeMessage, pluralUnit, translate, type Language, type MessageKey, type TranslationValues } from './shared/i18n';

function createI18n(language: Language) {
  return {
    language,
    t: (key: MessageKey, values?: TranslationValues) => translate(language, key, values),
    unit: (unit: Parameters<typeof pluralUnit>[1], count: number) => pluralUnit(language, unit, count),
    message: (text: string) => localizeMessage(language, text),
  };
}

const I18nContext = createContext(createI18n('pl'));

export function I18nProvider({ language, children }: { language: Language; children: ReactNode }) {
  const value = useMemo(() => createI18n(language), [language]);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() { return useContext(I18nContext); }
