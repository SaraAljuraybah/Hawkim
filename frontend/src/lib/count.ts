import type { CountText } from '../content/types'

const pluralRules = new Intl.PluralRules('en')

/** "1 user" / "9 users": the template for the count's plural form, with `{count}` replaced. */
export function formatCount(count: number, text: CountText): string {
  return (pluralRules.select(count) === 'one' ? text.one : text.other).replace('{count}', String(count))
}
