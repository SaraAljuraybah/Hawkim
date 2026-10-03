import type { ReactNode } from 'react'
import { UserPlus } from 'lucide-react'
import type { SopWorkflowContent } from '../../content/types'
import { getUser } from '../../data/mock/users'
import type { Sop } from '../../data/mock/types'
import { Button } from '../ui/Button'
import { DecisionBadge } from './DecisionBadge'

interface PeopleListProps {
  sop: Sop
  content: SopWorkflowContent['people']
  /** The signed-in user ("(you)" is added after their name). */
  userId: string
  /** Only the main author manages co-authors, and not once the SOP is published. */
  canManageCoAuthors: boolean
  onAddCoAuthor: (trigger: HTMLElement) => void
  onRemoveCoAuthor: (userId: string, trigger: HTMLElement) => void
}

function Group({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="min-w-0">
      <h3 className="text-sm font-semibold text-maroon">{title}</h3>
      <div className="mt-2">{children}</div>
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

const rowClasses = 'flex flex-wrap items-center gap-x-3 gap-y-1.5'

/**
 * Who works on this SOP: the author, co-authors, and the reviewers and approvers
 * with each person's decision in the current round.
 */
export function PeopleList({ sop, content, userId, canManageCoAuthors, onAddCoAuthor, onRemoveCoAuthor }: PeopleListProps) {
  const name = (id: string) => {
    const userName = getUser(id)?.name ?? ''
    return id === userId ? `${userName} ${content.you}` : userName
  }
  const empty = (text: string) => <p className="text-sm text-text-gray">{text}</p>

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <Group title={content.author}>
        <p className="text-[0.9375rem] text-maroon">{sop.authorId && name(sop.authorId)}</p>
      </Group>

      <Group
        title={content.coAuthors}
        action={
          canManageCoAuthors && (
            <Button size="sm" variant="secondary" onClick={(event) => onAddCoAuthor(event.currentTarget)}>
              <UserPlus aria-hidden="true" className="size-4" strokeWidth={2} />
              {content.addCoAuthor}
            </Button>
          )
        }
      >
        {sop.coAuthorIds.length === 0 ? (
          empty(content.noCoAuthors)
        ) : (
          <ul className="space-y-2">
            {sop.coAuthorIds.map((id) => (
              <li key={id} className={rowClasses}>
                <span className="text-[0.9375rem] text-maroon">{name(id)}</span>
                {canManageCoAuthors && (
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label={content.removeLabel.replace('{name}', getUser(id)?.name ?? '')}
                    onClick={(event) => onRemoveCoAuthor(id, event.currentTarget)}
                  >
                    {content.remove}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Group>

      {(
        [
          [content.reviewers, sop.reviewers],
          [content.approvers, sop.approvers],
        ] as const
      ).map(([title, people]) => (
        <Group key={title} title={title}>
          {people.length === 0 ? (
            empty(content.notAssigned)
          ) : (
            <ul className="space-y-2">
              {people.map((person) => (
                <li key={person.userId} className={rowClasses}>
                  <span className="text-[0.9375rem] text-maroon">{name(person.userId)}</span>
                  <DecisionBadge decision={person.decision} labels={content.decisions} />
                </li>
              ))}
            </ul>
          )}
        </Group>
      ))}
    </div>
  )
}
