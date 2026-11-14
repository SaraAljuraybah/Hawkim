/**
 * The admin portal's data tables (Users, GVP Version History, a GVP version's Requirements): a real
 * <table> from md up and stacked cards below md, in a white rounded frame. The header uses the
 * sidebar's maroon with off-white text (about 16:1); the header cells carry the colour, so the first
 * and last keep the frame's rounded top corners.
 */
export const tableStyles = {
  /** The white rounded frame around both layouts. */
  frame: 'rounded-xl border border-beige bg-white',
  /** The table's layout: md and up. */
  wide: 'hidden md:block',
  /** The stacked cards: below md. */
  cards: 'divide-y divide-beige md:hidden',
  table: 'w-full text-left text-sm',
  head: 'text-offwhite [&_th]:bg-maroon',
  headCell: 'px-5 py-3 font-semibold first:rounded-tl-xl last:rounded-tr-xl',
  body: 'divide-y divide-beige',
  /** The first cell of each row (`<th scope="row">`). */
  rowHeader: 'px-5 py-3.5 font-medium text-maroon',
  cell: 'px-5 py-3.5',
  /**
   * One column per action (Preview, Edit, Delete), as on Divisions and Departments: each 6rem wide
   * (`actionCol`, on a <col>), its heading centred above its button, so they line up vertically.
   */
  actionCol: 'w-24',
  actionHead: 'px-2 py-3 text-center font-semibold last:rounded-tr-xl',
  actionCell: 'px-2 py-3.5 text-center [&>*]:mx-auto',
}
