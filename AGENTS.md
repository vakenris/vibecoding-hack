# Repository Guidelines

## Purpose and Context

- Keep this guide applicable as the product, technology, and architecture evolve.
- At setup, the repository contains documentation, with no application or test tooling.
- Use `README.md` for setup and runnable commands as implementation develops.
- Treat `lifepilot_plan_4_people.md` as product planning context, not an immutable design.

## Understand Before Changing

- Establish the requested outcome and what behavior would demonstrate success.
- Read relevant source, documentation, configuration, and nearby instructions.
- Prefer targeted searches and current repository evidence over assumptions.
- Inspect pending changes and preserve work that belongs to others.
- Resolve small, reversible choices autonomously; state material assumptions.
- Clarify genuine ambiguity or significant risk before dependent work proceeds.

## Scale the Workflow

- Simple tasks: understand, change, verify. A formal plan is unnecessary.
- Complex tasks: investigate, consider trade-offs, briefly plan, implement incrementally, verify.
- Keep plans proportional to uncertainty, impact, and reversibility.
- Use tools or delegation when they add value; no mandatory orchestration or discovery ritual.

## Engineering Quality and Maintainability

- Prefer simple, readable solutions that solve the actual problem.
- Follow established naming, formatting, and language conventions where reasonable.
- Make focused changes; avoid unrelated cleanup, speculative abstractions, and needless layers.
- Allow justified refactoring when it improves the requested change; explain significant trade-offs.
- Use clear names and cohesive responsibilities; comment on non-obvious reasons and constraints.
- Keep documentation accurate when behavior, configuration, or commands change.

## Architecture and Interfaces

- Let requirements and evidence guide boundaries, persistence, frameworks, and directory layout.
- Reuse existing capabilities when suitable; evolve architecture when the benefit is concrete.
- When changing public interfaces, update affected consumers, documentation, and tests together.
- Consider compatibility and migration for persisted data or external consumers when applicable.

## Testing and Verification

- Use existing test, build, lint, and formatting commands when available.
- Verify meaningful behavior with checks proportional to the change and its risk.
- Add or update tests for changed behavior and bug fixes where they provide useful protection.
- Cover relevant failure cases and boundaries; avoid tests that merely mirror implementation.
- Do not invent coverage thresholds, tooling, successful runs, or test results.
- If checks cannot run, state what was checked, what remains unverified, and why.
- `git diff --check` checks whitespace in tracked diffs; it does not prove application correctness.

## Debugging

- Reproduce the issue or gather concrete evidence before selecting a fix.
- Trace the relevant execution path and distinguish symptoms from causes.
- Test focused hypotheses; verify the correction and relevant regressions.
- Keep diagnostic output targeted and remove temporary instrumentation unless intentionally retained.

## Security and Dependencies

- Use least privilege for commands, filesystem access, integrations, and credentials.
- Keep secrets and sensitive user data out of source control, logs, examples, and reports.
- Validate untrusted input at appropriate boundaries and handle failures explicitly.
- Prefer existing dependencies or standard libraries when they meet the need.
- Add dependencies for a clear benefit; consider maintenance, compatibility, licensing, and security.
- Update relevant manifests and lockfiles together; document necessary configuration without secrets.

## Git and Collaboration

- Review the final diff for scope, accidental deletions, secrets, and generated output.
- Preserve unrelated edits; do not reset or overwrite others' work.
- Commit, push, deploy, or perform destructive Git operations only when authorized by the task.
- Follow established commit conventions; otherwise use concise, imperative subjects.
- Describe the purpose, material changes, and validation in pull requests; link issues when relevant.
- Include screenshots or other evidence when useful for evaluating visible changes.

## Communication

- Communicate in the user's language with concise, concrete explanations.
- For longer work, share meaningful findings, risks, and changes of direction.
- Explain the result, verification performed, and material limitations at completion.
- Clearly distinguish observed behavior, assumptions, and proposed follow-up work.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
