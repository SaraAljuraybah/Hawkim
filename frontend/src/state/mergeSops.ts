import type { Sop, TimelineEventType } from '../data/mock/types'

/*
 * SOPs come from the database, but some of their parts are still kept only in this
 * tab: status changes, compliance checks, review requests, comments and the other
 * timeline events. These functions put the two together. Pure functions.
 */

/** Timeline events the database keeps; every other kind is still kept in the browser. */
const DATABASE_EVENTS = new Set<TimelineEventType>(['version-uploaded', 'version-deleted', 'co-author-added', 'co-author-removed'])

/**
 * An SOP read from the database, with the parts this tab already keeps for it. The
 * database wins for what it owns (identity, title, department, author, co-authors,
 * versions and files, and its timeline events); the tab keeps the rest, including
 * the status once the SOP is known here.
 */
export function mergeSop(stored: Sop, kept: Sop | undefined): Sop {
  if (!kept) return stored
  return {
    ...kept,
    id: stored.id,
    code: stored.code,
    title: stored.title,
    description: stored.description,
    departmentId: stored.departmentId,
    authorId: stored.authorId,
    coAuthorIds: stored.coAuthorIds,
    version: stored.version,
    fileName: stored.fileName,
    fileType: stored.fileType,
    fileUrl: undefined,
    versions: stored.versions,
    lastUpdated: stored.lastUpdated > kept.lastUpdated ? stored.lastUpdated : kept.lastUpdated,
    timeline: [...stored.timeline, ...kept.timeline.filter((event) => !DATABASE_EVENTS.has(event.type))]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  }
}

/**
 * The tab's SOPs after reading `stored` from the database: new ones first, known ones
 * merged in place, and every other SOP kept (sample SOPs, and SOPs read while someone
 * else was signed in in this tab).
 */
export function mergeSops(current: Sop[], stored: Sop[]): Sop[] {
  const known = new Set(current.map((sop) => sop.id))
  const storedById = new Map(stored.map((sop) => [sop.id, sop]))
  return [
    ...stored.filter((sop) => !known.has(sop.id)),
    ...current.map((sop) => {
      const update = storedById.get(sop.id)
      return update ? mergeSop(update, sop) : sop
    }),
  ]
}
