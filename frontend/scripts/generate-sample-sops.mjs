/*
 * Generates one placeholder PDF per mock SOP into public/sample-sops/.
 *
 * Run from frontend/:  npm run generate:sample-sops
 *
 * Requires Node 22.18+ (it imports the TypeScript mock data files directly,
 * using Node's built-in TypeScript support). The generated PDFs are committed,
 * so this only needs to run again when the mock SOP data changes.
 *
 * The PDFs are clearly marked as samples and contain only neutral placeholder
 * text — no real or realistic SOP content.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { getDepartmentName } from '../src/data/mock/departments.ts'
import { sops } from '../src/data/mock/sops.ts'
import { formatDate } from '../src/lib/format.ts'

const OUTPUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sample-sops')

// Brand colours (from src/index.css)
const MAROON = rgb(0x3a / 255, 0x0b / 255, 0x18 / 255)
const TEXT_GRAY = rgb(0x55 / 255, 0x56 / 255, 0x5a / 255)
const BEIGE = rgb(0xf1 / 255, 0xec / 255, 0xe4 / 255)
const WHITE = rgb(1, 1, 1)

const PLACEHOLDER =
  'This is placeholder text used to demonstrate how an SOP document is displayed in Hawkim. ' +
  'It does not describe a real procedure and must not be used for any operational purpose.'

const SECTIONS = [
  ['1. Purpose', PLACEHOLDER],
  ['2. Scope', PLACEHOLDER],
  ['3. Procedure', `${PLACEHOLDER} Steps, responsibilities and records would appear in this section of a real SOP.`],
]

/** Splits text into lines that fit within maxWidth at the given font size. */
function wrap(text, font, size, maxWidth) {
  const lines = []
  let line = ''
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word
    if (font.widthOfTextAtSize(next, size) > maxWidth && line) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines
}

async function createSamplePdf(sop) {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`${sop.code} ${sop.title} (sample)`)
  pdf.setSubject('Sample document for demonstration only')
  pdf.setCreator('Hawkim sample generator')

  const page = pdf.addPage([595.28, 841.89]) // A4
  const { width, height } = page.getSize()
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const margin = 56
  const contentWidth = width - margin * 2

  // Sample banner
  page.drawRectangle({ x: 0, y: height - 44, width, height: 44, color: MAROON })
  const banner = 'SAMPLE DOCUMENT — for demonstration only'
  page.drawText(banner, {
    x: (width - bold.widthOfTextAtSize(banner, 13)) / 2,
    y: height - 28,
    size: 13,
    font: bold,
    color: WHITE,
  })

  // Code and title
  let y = height - 100
  page.drawText(sop.code, { x: margin, y, size: 13, font: bold, color: MAROON })
  y -= 30
  for (const line of wrap(sop.title, bold, 22, contentWidth)) {
    page.drawText(line, { x: margin, y, size: 22, font: bold, color: MAROON })
    y -= 28
  }

  // Details box
  const details = [
    ['Department', getDepartmentName(sop.departmentId)],
    ['Version', sop.version],
    ['Last updated', formatDate(sop.lastUpdated)],
  ]
  const boxHeight = details.length * 20 + 12
  y -= 8
  page.drawRectangle({ x: margin, y: y - boxHeight + 18, width: contentWidth, height: boxHeight, color: BEIGE })
  for (const [label, value] of details) {
    page.drawText(`${label}:`, { x: margin + 14, y, size: 11, font: bold, color: MAROON })
    page.drawText(value, { x: margin + 110, y, size: 11, font: regular, color: TEXT_GRAY })
    y -= 20
  }
  y -= 36

  // Placeholder sections
  for (const [heading, text] of SECTIONS) {
    page.drawText(heading, { x: margin, y, size: 14, font: bold, color: MAROON })
    y -= 22
    for (const line of wrap(text, regular, 11, contentWidth)) {
      page.drawText(line, { x: margin, y, size: 11, font: regular, color: TEXT_GRAY })
      y -= 16
    }
    y -= 18
  }

  // Footer
  const footer = `${sop.code} · Sample document for demonstration only · Hawkim`
  page.drawText(footer, {
    x: (width - regular.widthOfTextAtSize(footer, 9)) / 2,
    y: 32,
    size: 9,
    font: regular,
    color: TEXT_GRAY,
  })

  return pdf.save()
}

await mkdir(OUTPUT_DIR, { recursive: true })
for (const sop of sops) {
  const bytes = await createSamplePdf(sop)
  const file = join(OUTPUT_DIR, `${sop.code}.pdf`)
  await writeFile(file, bytes)
  console.log(`Created ${sop.code}.pdf (${Math.round(bytes.length / 1024)} KB)`)
}
