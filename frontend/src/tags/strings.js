// UI strings for tags, English and French (other languages fall back to English). Kept in one
// module rather than the shared locale files; moving them there is a mechanical step if wanted.
import { useTranslation } from 'react-i18next';

const STRINGS = {
  en: {
    'pill.title': '{name}: {source}',
    'source.manual': 'set by hand',
    'source.auto': 'added by {source}',
    'header.tags': 'Tags',
    'header.hide': 'Hide tags',
    'header.none': 'No tags defined yet. Create some in Settings.',
    'filter.all': 'All mail',
    'filter.label': 'Tag filter',
    'filter.modeAny': 'any of them',
    'filter.modeAll': 'all of them',
    'filter.modeHint': 'Show mail with any of the selected tags, or only mail with all of them',
    'menu.tags': 'Tags',
    'picker.add': 'Add',
    'picker.remove': 'Remove',
    'picker.count': '{n} of {total}',
    'toast.added': 'Tag "{name}" added to {n} message(s)',
    'toast.removed': 'Tag "{name}" removed from {n} message(s)',
    'toast.failed': 'Could not update the tag: {error}',
    'settings.title': 'Tags',
    'settings.note': 'Tags are stored in MailFlow only; nothing is written to your mail servers.',
    'settings.name': 'Name',
    'settings.color': 'Color',
    'settings.key': 'Key (lowercase letters, digits, _)',
    'settings.on': 'on',
    'settings.edit': 'Edit',
    'settings.close': 'Close',
    'settings.save': 'Save',
    'settings.delete': 'Delete',
    'settings.confirmDelete': 'Delete the tag "{name}" and remove it from every message?',
    'settings.add': 'Add a tag',
    'settings.create': 'Create',
    'settings.cancel': 'Cancel',
  },
  fr: {
    'pill.title': '{name} : {source}',
    'source.manual': 'défini à la main',
    'source.auto': 'ajouté par {source}',
    'header.tags': 'Tags',
    'header.hide': 'Masquer les tags',
    'header.none': "Aucun tag défini. Créez-en dans les réglages.",
    'filter.all': 'Tous les mails',
    'filter.label': 'Filtre par tag',
    'filter.modeAny': "l'un d'eux",
    'filter.modeAll': 'tous',
    'filter.modeHint': "Afficher les mails ayant l'un des tags choisis, ou seulement ceux qui les ont tous",
    'menu.tags': 'Tags',
    'picker.add': 'Ajouter',
    'picker.remove': 'Retirer',
    'picker.count': '{n} sur {total}',
    'toast.added': 'Tag « {name} » ajouté à {n} message(s)',
    'toast.removed': 'Tag « {name} » retiré de {n} message(s)',
    'toast.failed': 'Impossible de modifier le tag : {error}',
    'settings.title': 'Tags',
    'settings.note': "Les tags sont stockés dans MailFlow uniquement ; rien n'est écrit sur vos serveurs de messagerie.",
    'settings.name': 'Nom',
    'settings.color': 'Couleur',
    'settings.key': 'Clé (lettres minuscules, chiffres, _)',
    'settings.on': 'actif',
    'settings.edit': 'Modifier',
    'settings.close': 'Fermer',
    'settings.save': 'Enregistrer',
    'settings.delete': 'Supprimer',
    'settings.confirmDelete': 'Supprimer le tag « {name} » et le retirer de tous les messages ?',
    'settings.add': 'Ajouter un tag',
    'settings.create': 'Créer',
    'settings.cancel': 'Annuler',
  },
};

export function translate(lang, key, vars) {
  const table = STRINGS[String(lang || 'en').slice(0, 2)] || STRINGS.en;
  const text = table[key] ?? STRINGS.en[key] ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? '')) : text;
}

export function useT() {
  const { i18n } = useTranslation();
  return (key, vars) => translate(i18n.language, key, vars);
}
