# Pushkar's agent instructions

These are common instructions for Pushkar's agents across all scenarios.

## General Guidelines

- Never use the em dash "—". Use plain dash "-" instead.
- When writing commit messages, never auto-add your agent name as co-author.
- Never manually modify `CHANGELOG.md` files or any files marked as auto-generated.
- When writing or substantially editing long Markdown files, put each full sentence on its own line. Preserve normal Markdown structure, but avoid wrapping multiple sentences onto one physical line.
- When making technical decisions, do not give much weight to development cost. Prefer quality, simplicity, robustness, scalability, and long-term maintainability.
- For bug fixes, first reproduce the bug in an end-to-end setting as close as possible to end-user conditions. This helps confirm the real problem and validate that the fix solves it.
- When end-to-end testing a product, hold the UI to a high standard and fix clear visual defects you encounter, even when they are outside the immediate change.
- Apply the same engineering standard to lint, test failures, and test flakiness. Fix issues you encounter even when they are outside the immediate change.

## Pushkar's Opinions

When a task would benefit from Pushkar's viewpoints, read only the relevant sections of `/Users/pushkar/OPINIONS.md`.

## Repository AGENTS.md

For every repository you create or work in, ensure a root-level `AGENTS.md` exists and contains these common instructions.
For an existing `AGENTS.md`, preserve project-specific guidance and integrate these instructions without duplicating them.
For a new repository, create `AGENTS.md` as part of initial setup.
Do not overwrite project-specific instructions.
