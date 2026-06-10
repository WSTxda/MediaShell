# Contributing

## Workflow

1. Clone the repository.
2. Install the declared development dependencies:

```bash
pnpm install
```

3. Check the local GNOME development environment:

```bash
pnpm doctor
```

4. Start the debug workflow:

```bash
pnpm debug
```

5. Make a focused change and update tests, translations, and documentation when they are affected.
6. Run the maintained validation suite:

```bash
pnpm check
```

7. Build and test the packaged extension before opening a pull request:

```bash
pnpm build
```

## Pull requests

Keep changes narrowly scoped. Describe the behavior being changed, the affected MPRIS or GNOME Shell scenario, and the live checks performed. Include focused logs for lifecycle, D-Bus, or private Shell API failures.

Follow the ownership and process boundaries in [Architecture](docs/ARCHITECTURE.md) and the risk-based test guidance in [Development and validation](docs/DEVELOPMENT.md).
