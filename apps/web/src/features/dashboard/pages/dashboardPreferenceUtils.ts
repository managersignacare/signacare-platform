import {
  DASHBOARD_CARD_CATALOG,
  DEFAULT_DASHBOARD_PREFERENCES,
  type DashboardCardDefinition,
  type DashboardPreferences,
  type DashboardViewId,
  getDashboardCardsForView,
  isSafetyCriticalDashboardCard,
  normalizeDashboardPreferences,
} from '@signacare/shared';

export function readDashboardPreferences(
  preferences: DashboardPreferences | null | undefined,
): DashboardPreferences {
  return normalizeDashboardPreferences(preferences ?? DEFAULT_DASHBOARD_PREFERENCES);
}

export function isDashboardViewEnabled(
  preferences: DashboardPreferences | null | undefined,
  viewId: DashboardViewId,
): boolean {
  return readDashboardPreferences(preferences).enabledViews.includes(viewId);
}

export function getVisibleDashboardCards(
  preferences: DashboardPreferences | null | undefined,
  viewId: DashboardViewId,
): DashboardCardDefinition[] {
  const resolved = readDashboardPreferences(preferences);
  const viewPreference = resolved.viewPreferences[viewId];
  const hidden = new Set(viewPreference?.hiddenCardIds ?? []);
  const cards = getDashboardCardsForView(viewId).filter((card) => !hidden.has(card.id));
  const order = viewPreference?.cardOrder ?? [];
  if (order.length === 0) return cards;
  const indexById = new Map(order.map((id, index) => [id, index]));
  return [...cards].sort((a, b) => {
    const ai = indexById.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const bi = indexById.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return ai - bi;
  });
}

export function setDashboardViewEnabled(
  preferences: DashboardPreferences | null | undefined,
  viewId: DashboardViewId,
  enabled: boolean,
): DashboardPreferences {
  const resolved = readDashboardPreferences(preferences);
  const enabledViews = new Set(resolved.enabledViews);
  if (enabled) enabledViews.add(viewId);
  else enabledViews.delete(viewId);
  const next = normalizeDashboardPreferences({
    ...resolved,
    enabledViews: enabledViews.size > 0 ? [...enabledViews] : [viewId],
  });
  return next;
}

export function setDashboardCardHidden(
  preferences: DashboardPreferences | null | undefined,
  viewId: DashboardViewId,
  cardId: string,
  hidden: boolean,
): DashboardPreferences {
  if (isSafetyCriticalDashboardCard(cardId)) {
    return readDashboardPreferences(preferences);
  }
  const resolved = readDashboardPreferences(preferences);
  const currentView = resolved.viewPreferences[viewId] ?? {
    layoutMode: 'clinical_cockpit' as const,
    hiddenCardIds: [],
    cardOrder: [],
  };
  const hiddenIds = new Set(currentView.hiddenCardIds);
  if (hidden) hiddenIds.add(cardId);
  else hiddenIds.delete(cardId);
  return normalizeDashboardPreferences({
    ...resolved,
    viewPreferences: {
      ...resolved.viewPreferences,
      [viewId]: {
        ...currentView,
        hiddenCardIds: [...hiddenIds],
      },
    },
  });
}

export function getDashboardCatalogForView(viewId: DashboardViewId): DashboardCardDefinition[] {
  return DASHBOARD_CARD_CATALOG.filter((card) => card.viewId === viewId);
}
