# Linting & Formatting Rules

## Core rules
- ESLint + @typescript-eslint: enforce unused vars, discourage `console` (allowed only in CLI/tests), strict typing.
- Prettier: `singleQuote`, `trailingComma: es5`, `printWidth: 100`, `semi: true`.
- Ignored folders: `build/`, `dist/`, `temp_dist/`, `test_dist/`, `artifacts/`, `src/types/generated/`, `scripts/legacy/`.

## How to run
```bash
npm run lint          # ESLint
npm run format        # auto-format
npm run format:check  # formatting check only
npm run check:structure  # ensure ts files stay in allowed roots
npm run check:docs       # basic doc validation
```

## Local exceptions
- CLI (`src/ux/cli_interface.ts`) uses `/* eslint-disable no-console */` because it prints user-facing messages.
- If you must disable a rule, use a scoped directive with a comment:
  ```ts
  // eslint-disable-next-line no-console -- temporary debug output
  console.log(data);
  ```
- Prefer replacing `console` with the logger (`getLogger().info/error`) and removing unused variables instead of disabling rules.

## Adding new rules
- Edit `eslint.config.cjs`; keep compatibility with Prettier (`eslint-config-prettier` already included).
- Add new generated/artifact paths to `ignores` as needed.
