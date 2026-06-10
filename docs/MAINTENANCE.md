# Maintenance

## Repository surface

Maintain source under `src/`, resources under `assets/`, tests under `tests/`, tooling under `scripts/`, and documentation under `docs/`.

Do not commit `dist/`, packaged archives, compiled schemas, compiled GResources, logs, caches, or editor state.

## Contract changes

A change affecting identity, compatibility, UI terminology, settings, MPRIS behavior, resources, or packaging must update every relevant source of truth in the same commit.

Do not document temporary counts, current release versions, generated package sizes, or test totals. Reference the authoritative file instead.

## Logging

Logs must identify the failing subsystem or operation, avoid continuous hot-path output, and distinguish expected cancellation from actionable failure. Use one-shot logging for repeated third-party failures.

## Private Shell APIs

`SystemMediaControlsPatch` is the only intentional private GNOME Shell integration. Keep it isolated, capability-checked, reversible, and fail-open so GNOME's controls remain available when internals change.

## Release

1. Start from a clean tree.
2. Update release metadata in the authoritative manifest and package files.
3. Refresh translations.
4. Run `pnpm check` and `pnpm build`.
5. Install and complete the live matrix in `docs/VALIDATION.md`.
6. Publish the generated package from `dist/builds/`.
7. Upload the same package to the project release and GNOME Extensions.

## Documentation review

Before release, verify that:

- README features exist in the current UI;
- canonical names match `docs/UI_CONTRACT.md`;
- every documented path and command exists;
- compatibility matches `src/metadata.json`;
- no retired file, old project name, temporary version, or generated artifact is referenced;
- comments explain current invariants rather than historical implementation.
