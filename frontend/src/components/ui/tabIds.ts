/** Ids that connect a tab and its panel (aria-controls / aria-labelledby). */
export function tabIds(idPrefix: string, key: string) {
  return { tab: `${idPrefix}-tab-${key}`, panel: `${idPrefix}-panel-${key}` }
}
