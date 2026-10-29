export type Language = 'fr' | 'en';
export function detectLanguage(preferences: readonly string[]): Language {
  for (const preference of preferences) {
    const base = preference.trim().toLowerCase().split(/[-_;]/)[0];
    if (base === 'fr' || base === 'en') return base;
  }
  return 'en';
}
export function requestLanguage(value: string): Language {
  const preferences = value
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.find(p => p.trim().startsWith('q='));
      return { tag, index, quality: q ? Number(q.trim().slice(2)) : 1 };
    })
    .filter(p => Number.isFinite(p.quality) && p.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);
  return detectLanguage(preferences.map(p => p.tag));
}
export const language: Language =
  typeof document === 'undefined' || typeof navigator === 'undefined'
    ? 'fr'
    : detectLanguage(navigator.languages?.length ? navigator.languages : [navigator.language]);
type Variables = Record<string, string | number>;
/** French translations, keyed by the English source text. */
const french: Record<string, string> = {
  // Configuration labels, also translated back to English when written in French.
  Default: 'Défaut',
  Low: 'Faible',
  Medium: 'Moyen',
  High: 'Élevé',
  Developer: 'Développeur',
  Architect: 'Architecte',
  Analyst: 'Analyste',
  // Interface and server messages.
  'Access denied.': 'Accès refusé.',
  'Active MCPs: {active} of {total}': 'MCP actifs : {active} sur {total}',
  'Add files': 'Ajouter des fichiers',
  Agents: 'Agents',
  'All sessions have been deleted.': 'Toutes les sessions ont été supprimées.',
  'An MCP server is no longer available. Reload the page and try again.':
    'Un serveur MCP n’est plus disponible. Rechargez la page puis réessayez.',
  'Ask anything, / for commands, @ for context...':
    'Demandez n’importe quoi, / pour les commandes, @ pour le contexte...',
  Cancel: 'Annuler',
  'Choose agent': 'Choisir l’agent',
  'Choose model': 'Choisir le modèle',
  'Choose which models to show in the menu.': 'Choisissez les modèles à afficher dans le menu.',
  'Close MCP servers': 'Fermer les MCP',
  'Close models': 'Fermer les modèles',
  'Close tab': 'Fermer l’onglet',
  Commands: 'Commandes',
  connected: 'connecté',
  'connecting…': 'connexion…',
  'Conversations and drafts will be permanently deleted from this browser.':
    'Les conversations et les brouillons seront définitivement effacés de ce navigateur.',
  'Could you clarify your request?': 'Pourriez-vous préciser votre demande ?',
  'Create a new session': 'Créer une nouvelle session',
  'Create session': 'Créer une session',
  Delete: 'Supprimer',
  'Delete all sessions': 'Supprimer toutes les sessions',
  'Delete all sessions?': 'Supprimer toutes les sessions ?',
  disabled: 'désactivé',
  Done: 'Terminé',
  'Enable or disable MCP servers': 'Activer ou désactiver les MCP',
  'Enter a question with fewer than 16,000 characters.': 'Veuillez saisir une question de moins de 16 000 caractères.',
  Error: 'Erreur',
  'History could not be saved.': 'L’historique n’a pas pu être enregistré.',
  Interrupted: 'Interrompu',
  'Manage models': 'Gérer les modèles',
  'MCP states must be booleans for each server.': 'Les états MCP doivent être des booléens par serveur.',
  'Method not allowed.': 'Méthode non autorisée.',
  Models: 'Modèles',
  'New session': 'Nouvelle session',
  'No commands found': 'Aucune commande trouvée',
  'No MCP servers available.': 'Aucun serveur MCP disponible.',
  'No models found': 'Aucun modèle trouvé',
  'No recent sessions.': 'Aucune session récente.',
  'No servers found.': 'Aucun serveur trouvé.',
  'Not found.': 'Introuvable.',
  'Open sessions': 'Sessions ouvertes',
  PARAMETERS: 'PARAMÈTRES',
  'Reasoning level': 'Niveau de réflexion',
  'Reasoning level: {level}': 'Niveau de réflexion : {level}',
  'Remove files': 'Retirer les fichiers',
  RESULT: 'RÉSULTAT',
  Retry: 'Réessayer',
  Running: 'En cours',
  Search: 'Rechercher',
  'Search MCP servers': 'Rechercher des serveurs MCP',
  'Search models': 'Rechercher des modèles',
  Send: 'Envoyer',
  Sessions: 'Sessions',
  Show: 'Afficher',
  'Show sessions': 'Afficher les sessions',
  Stop: 'Arrêter',
  'Stop the response before closing this tab.': 'Arrêtez la réponse avant de fermer cet onglet.',
  'Stop the response before deleting sessions.': 'Arrêtez la réponse avant de supprimer les sessions.',
  'Stop the response before switching sessions.': 'Arrêtez la réponse avant de changer de session.',
  'The connection was interrupted.': 'La connexion a été interrompue.',
  'The connection was interrupted. Please try again.': 'La connexion a été interrompue. Veuillez réessayer.',
  'The service is temporarily unavailable.': 'Le service est momentanément indisponible.',
  'The service is temporarily unavailable. Please try again.':
    'Le service est momentanément indisponible. Veuillez réessayer.',
  'The service is temporarily unavailable. Reload the page.':
    'Le service est momentanément indisponible. Rechargez la page.',
  Thinking: 'Réflexion',
  'This choice is no longer available. Reload the page and try again.':
    'Ce choix n’est plus disponible. Rechargez la page puis réessayez.',
  'Unknown command: {name}': 'Commande inconnue : {name}',
  'Use /mcp from the interface.': 'La commande /mcp s’utilise depuis l’interface.',
  'Use /new from the interface.': 'La commande /new s’utilise depuis l’interface.',
  You: 'Vous',
  'Your question': 'Votre question',
};
/** Gendered French forms, keyed by `context|English source`. */
const frenchInContext: Record<string, string> = {
  'thinking|Interrupted': 'Interrompue',
  'thinking|Done': 'Terminée',
};
/** Lets French labels from the configuration, such as agent names, display in English. */
const english = Object.fromEntries(Object.entries(french).map(([source, translation]) => [translation, source]));
export function translate(message: string, locale: Language, variables: Variables = {}, context?: string): string {
  const value =
    locale === 'fr'
      ? ((context ? frenchInContext[`${context}|${message}`] : undefined) ?? french[message] ?? message)
      : (english[message] ?? message);
  return value.replace(/\{(\w+)\}/g, (marker, key: string) => String(variables[key] ?? marker));
}
export const t = (message: string, variables: Variables = {}, context?: string) =>
  translate(message, language, variables, context);
