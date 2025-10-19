# Repository Guidelines

## Project Structure & Module Organization
`index.ts` is the Bun entry point; keep it focused on the PM2-monitor workflow and extract reusable helpers into future `/lib` or `/services` folders. `tsconfig.json` defines module resolution for TypeScript—mirror any new source folders there. Lock the dependency graph with `bun.lock` and do not edit `node_modules/`; reinstall with `bun install` when dependencies change. Place assets or long-lived configuration files under a dedicated subfolder instead of the root.

## Build, Test, and Development Commands
- `bun install` – install or update runtime and type dependencies.
- `bun run index.ts` – execute the monitor locally; add `--watch` while iterating.
- `bun test` – run the Bun-native test runner once you add specs under `tests/`.
Document any additional scripts in `package.json` so teammates see the canonical workflow.

## Coding Style & Naming Conventions
Write modern TypeScript using ES modules (`import`/`export`). Prefer 2-space indentation, `const` over `let`, and arrow functions for callbacks. Keep functions small and pure where practical, naming modules with kebab-case filenames (`process-health.ts`) and exported classes in PascalCase. Run `bun fmt` before opening a review to align with Bun’s opinionated formatting, and avoid committing lint warnings—track outstanding cleanup in TODO comments tagged with an owner.

## Testing Guidelines
Adopt the Bun test runner (`bun test`) with specs in `tests/**/*.test.ts`. Mirror runtime modules with one test file each, and name individual cases using the behavior under test (`it("restarts process when PM2 status is errored")`). Aim for high-leverage coverage around PM2 interactions and any retry/backoff logic; add integration stubs if external APIs are involved. Record known gaps in a `tests/README.md` so coverage expectations stay transparent.

## Commit & Pull Request Guidelines
The repository history is minimal, so follow Conventional Commits (`feat:`, `fix:`, `chore:`) to make change intent obvious. Write commit bodies that call out riskier code paths or follow-up tasks. Pull requests should include: a concise summary, reproduction or verification steps (`bun run index.ts`, `bun test`), screenshots when CLI output or dashboards change, and links to related issues. Invite a second reviewer for operational changes that touch process management or deployment scripts.
