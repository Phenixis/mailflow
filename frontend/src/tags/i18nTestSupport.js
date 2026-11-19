// Test support: a `t` that resolves keys from the real locale files with i18next-style {{var}}
// interpolation, and the source of a react-i18next stand-in backed by the English file.
import { readFileSync } from 'node:fs';

const load = (lang) => JSON.parse(readFileSync(new URL(`../locales/${lang}.json`, import.meta.url), 'utf8'));

export function makeT(lang = 'en') {
  const data = load(lang);
  return (key, vars) => {
    const text = key.split('.').reduce((node, part) => node?.[part], data);
    if (typeof text !== 'string') return key;
    return vars ? text.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? '')) : text;
  };
}

export function reactI18nextMockSource() {
  return [
    `const en = ${JSON.stringify(load('en'))};`,
    'const t = (key, vars) => {',
    '  const text = key.split(".").reduce((node, part) => node?.[part], en);',
    '  if (typeof text !== "string") return key;',
    '  return vars ? text.replace(/\\{\\{(\\w+)\\}\\}/g, (_, k) => String(vars[k] ?? "")) : text;',
    '};',
    'export const useTranslation = () => ({ t, i18n: { language: "en", changeLanguage: () => {} } });',
    'export const initReactI18next = { type: "3rdParty", init: () => {} };',
    'export default { useTranslation, initReactI18next };',
  ].join('\n');
}
