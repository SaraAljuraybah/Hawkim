import { describe, expect, it } from 'vitest'
import { uploadSopEn } from './mySops.en'
import { sopWorkflowEn } from './workflow.en'

/* Every source file under src (tests excluded), as text. */
const sources = import.meta.glob<string>(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}'], { query: '?raw', import: 'default', eager: true })

/**
 * Quoted strings and JSX text that say "upload" about SOPs or versions. Not text: routes ("/my-sops/upload"),
 * ids and keys ("upload", "version-uploaded"). Allowed: the Regulations guideline file (not an SOP) and the
 * storage service's technical error.
 */
function uploadTexts(path: string, source: string): string[] {
  const quoted = [...source.matchAll(/(['"`])((?:(?!\1)[^\n])*?\bupload(?:ed|ing|s)?\b(?:(?!\1)[^\n])*?)\1/gi)].map((match) => match[2])
  const jsx = path.endsWith('.tsx') ? [...source.matchAll(/>([^<>{}]*\bupload(?:ed|ing|s)?\b[^<>{}]*)</gi)].map((match) => match[1]) : []
  return [...quoted, ...jsx].filter((text) =>
    !/^(upload|version-uploaded)$/.test(text) && !text.includes('/upload') && !/guideline/i.test(text) && !path.endsWith('services/files.ts'))
}

describe('no visible "Upload" about SOPs or versions anywhere in the app', () => {
  it('finds none in any source file', () => {
    // It really reads the app's files, and would catch the old message.
    expect(Object.keys(sources).length).toBeGreaterThan(100)
    expect(uploadTexts('x.ts', "fileRequired: 'Upload an SOP file.'")).toEqual(['Upload an SOP file.'])
    expect(uploadTexts('x.tsx', '<button>Upload</button>')).toEqual(['Upload'])
    const found = Object.entries(sources).flatMap(([path, source]) => uploadTexts(path, source).map((text) => `${path}: ${text}`))
    expect(found).toEqual([])
  })

  it('says "Add an SOP file." for a missing file on Add SOP and in the new-version dialog', () => {
    expect(uploadSopEn.errors.fileRequired).toBe('Add an SOP file.')
    expect(sopWorkflowEn.dialogs.fileRequired).toBe('Add an SOP file.')
    expect(uploadSopEn.fields.file.typeError).toBe("This file type isn't supported. Add a .docx or PDF file.")
  })
})
