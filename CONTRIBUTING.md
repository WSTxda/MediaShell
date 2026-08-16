# Contributing

This document defines the requirements for contributing to MediaShell. Use [Architecture](docs/ARCHITECTURE.md) for ownership and process boundaries, and [Development](docs/DEVELOPMENT.md) for toolchain, implementation conventions, validation details, and live debugging.

## Before editing

Identify the component that already owns the behavior, its callers, and every persisted or external contract affected by the change. Extend that path when its responsibility matches; do not create a parallel service, renderer, settings path, or lifecycle owner for local convenience.

An architectural, structural, naming, or cross-surface refactor must include an integration map with:

- the existing owners and call paths studied;
- the authoritative integration point and code to reuse;
- exact files and symbols to add, move, rename, or remove;
- process-boundary, lifecycle, asynchronous-result, and compatibility risks;
- deterministic checks and live GNOME scenarios required for validation.

Internal moves and renames must update call sites atomically. Do not retain aliases, wrappers, duplicate implementations, or transitional directories without a real compatibility requirement.

## Change requirements

- Keep `src/shared/`, `src/shell/`, and `src/prefs/` within the boundaries defined by the architecture.
- Preserve settings keys and values, D-Bus interfaces, resource paths, GtkBuilder IDs, CSS classes, `GTypeName` values, action IDs, and other persisted or external contracts unless the change intentionally includes migration or compatibility work.
- Keep resource creation, signal connections, asynchronous work, and cleanup under the same owner. Results from a replaced owner or lifecycle must not mutate current state.
- Share implementation only when inputs, outputs, side effects, ownership, teardown, and expected evolution are the same. Similar Popup and Top Bar components are intentionally independent when those conditions differ.
- Keep constants pure and immutable. Runtime toolkit objects, caches, mutable state, and trivial one-use values remain with their owner.
- Update tests, declarative resources, translations, comments, and documentation only when the behavior or contract they represent changes.
- Test observable behavior and stable contracts. Do not add source-shape heuristics, style checks disguised as correctness checks, or tests that merely duplicate implementation details.
- Do not increase the test count for an organization-only refactor unless an important behavior or compatibility contract would otherwise be unprotected.
- Keep functional changes and unrelated cleanup separate.

## Translations

JavaScript strings shown to users use the project gettext helpers. GtkBuilder strings use `translatable="yes"`. Identifiers, protocol values, settings keys, and other code contracts are not translated.

After changing translatable text, regenerate the template and merge every locale catalog:

```bash
pnpm run translations
pnpm check
```

Review the resulting `.pot` and `.po` changes. Preserve existing translations, placeholders, plural forms, source references, translator comments, and valid catalog headers. Do not replace reviewed translations with generated placeholders.

`pnpm check` verifies source/catalog consistency without requiring the complete native toolchain. When gettext is available, `pnpm run check:native` also extracts and compiles the catalogs with the native tools.

## Validation

Install the locked dependencies once, then run the project gate for every contribution:

```bash
pnpm install
pnpm check
```

Run `pnpm build` when the change affects runtime source, schemas, resources, translations, packaging, or compatibility. Run `pnpm verify` for a release candidate or EGO submission. The generated extension must still be installed and exercised in GNOME; automated checks cannot validate Shell actor behavior, real MPRIS endpoints, visual output, or private Shell API compatibility.

Choose live scenarios from the changed contract. Record the GNOME version and, when relevant, the media app or MPRIS endpoint, settings involved, reproduction steps, and useful log output.

## Commits and pull requests

Keep each commit coherent and reviewable. Separate a prerequisite refactor, functional change, generated translation update, test adjustment, or broad documentation revision when that separation makes review and rollback safer.

A pull request must state:

- the behavior or contract changed and why;
- the affected Shell, Preferences, MPRIS, or packaging path;
- compatibility or migration consequences;
- automated commands run;
- live scenarios tested and GNOME versions used.

Include only diagnostic output that helps reproduce or explain a failure.

## Documentation changes

Update documentation when ownership, process boundaries, stable contracts, contributor obligations, supported workflows, or non-obvious compatibility constraints change. Do not duplicate widget instructions, visual dimensions, animation phases, defaults, or other implementation details that are already clear in source and expected to evolve.
