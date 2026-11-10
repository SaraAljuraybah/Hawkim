/*
 * English content for the Filter control (FilterPopover), shared by every list page that filters by
 * division and department: the SOP Directory, Staff, Divisions and Departments, and Organizational
 * Structure. One copy, so the control reads the same everywhere.
 */

import type { FiltersContent } from './types'

export const filtersEn: FiltersContent = {
  label: 'Filter',
  all: 'All',
  title: 'Filters',
  clearAll: 'Clear all',
  division: {
    legend: 'Division',
    empty: 'No divisions yet.',
    count: { one: '{count} division', other: '{count} divisions' },
  },
  department: {
    legend: 'Department',
    empty: 'No departments yet.',
    count: { one: '{count} department', other: '{count} departments' },
    unassigned: 'Unassigned departments',
  },
  permission: {
    legend: 'Permission',
    count: { one: '{count} permission', other: '{count} permissions' },
  },
}
