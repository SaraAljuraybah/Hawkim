/**
 * The Search | Filter | Sort row above a list, the same on every list page: stacked below lg, one row
 * from lg with the search on half the width (2fr | 1fr | 1fr). A page without a filter or sort leaves
 * those columns empty, so its search is just as wide. `relative`: a Filter panel set to `lg:static`
 * lines up with the row's right edge.
 */
export const LIST_TOOLBAR = 'relative grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] lg:items-end'
