# CLAUDE.md

Project rules for working on Hawkim (حَوكِم). Read README.md for project context.

## Git workflow

- Two branches only: `develop` and `main`.
- `develop` is the default branch. Commit and push all work directly to `develop`.
- `main` is the stable version only. It is updated by the project owner through a pull request from `develop`.
- Never push to `main`. Never merge any branch.
- Make small, logical commits with a prefix: `feat`, `fix`, `style`, `docs` or `chore`
  (e.g. `feat: add status badge`).

## Scope

- Build only what is explicitly asked for.
- Do not invent features, pages, user roles or workflows.
- If anything is unclear, ask before assuming.
- Show a plan before writing code.

## Frontend conventions (`frontend/`)

- Use the existing design tokens in `src/index.css` (Tailwind `@theme`). Do not hard-code colours.
- Reuse the existing components in `src/components/` before creating new ones; new shared components go in `src/components/ui/` or `src/components/layout/`.
- Follow the content-file pattern: all user-facing text lives in `src/content/*.en.ts` (types in `src/content/types.ts`). No hard-coded strings in components.
- Run `npm run build` and `npm run lint` before committing; both must pass.

## Accessibility

- All text must meet WCAG AA contrast (4.5:1 normal text, 3:1 large text).
- Gold is never used for small text on light backgrounds.
- Semantic HTML, one `h1` per page, logical heading order, visible focus states, and respect for `prefers-reduced-motion`.

## Brand

- Use only Hawkim's own logo, following the brand guidelines (never stretch, rotate, recolour, crop or add effects).
- Never use the SFDA logo or any Saudi government emblem.
