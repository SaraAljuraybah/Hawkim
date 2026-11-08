import { textBlocks } from './findingDetails'

/** A finding's text as paragraphs, with "•" items as a real bulleted list. */
export function FindingText({ text, className = '' }: { text: string; className?: string }) {
  const blocks = textBlocks(text)
  if (blocks.length === 0) return null
  return (
    <div className={`space-y-1.5 ${className}`}>
      {blocks.map((block, index) =>
        block.kind === 'paragraph' ? (
          <p key={index}>{block.text}</p>
        ) : (
          <ul key={index} className="list-disc space-y-1 pl-5">
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>{item}</li>
            ))}
          </ul>
        ),
      )}
    </div>
  )
}
