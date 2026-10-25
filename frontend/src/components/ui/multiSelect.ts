/** The selection after toggling one option: a click anywhere on its row, Space or Enter. */
export function toggleOption(value: string[], option: string): string[] {
  return value.includes(option) ? value.filter((item) => item !== option) : [...value, option]
}
