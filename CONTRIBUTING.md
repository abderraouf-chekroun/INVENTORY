# Contributing to INVENTORY

Thank you for your interest. This page explains how to set up the project, what a change must contain and which checks it must pass. The technical background is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Prerequisites

- Windows 11 (x64) with the WebView2 Runtime.
- Node.js and npm; continuous integration uses the major version given in `.nvmrc`.
- A stable Rust toolchain for `x86_64-pc-windows-msvc` (Rust 1.88 or newer).
- Visual Studio 2022 Build Tools with the C++ workload and a Windows SDK.

```powershell
npm ci
npm run tauri dev
```

## Branches and commits

- Work on a branch created from `main`, named after the change (for example `fix-import-preview` or `docs-migrations`).
- Keep each commit focused on one change, with a short summary line in the imperative mood and, when useful, a body explaining why.
- Open a pull request against `main` and describe what changes for the user, if anything.

## Checks before a pull request

Run the same commands as the continuous integration workflow (`.github/workflows/ci.yml`); all must pass:

```powershell
npm ci
npx tsc --noEmit
npx vitest run
npm run build
cd src-tauri; cargo test --locked; cd ..
```

The workflow also audits dependencies (`cargo audit` in `src-tauri`, `npm audit --omit=dev`); if you add or update a dependency, run them too when you can.

If your change affects what the user sees or does, also run the end-to-end suite on a release build (`npm run e2e:build`). Read [`tests/README.md`](tests/README.md) first: the suite drives the real mouse and keyboard. If you change `src-tauri/windows/hooks.nsh`, run `npm run test:installateur`.

## Coding conventions

These are the conventions the code base already follows:

- **TypeScript** in strict mode, with no unused locals or parameters. The front end calls the back end only through `src/api`.
- **No inline styles or scripts in markup.** The production Content Security Policy has no `'unsafe-inline'`: put styles in `src/styles/*.css`, express user-chosen values as CSS classes, and call `preventDefault()` in every form's `onSubmit`.
- **SQL** is always parameterised (`params![…]`); never build a statement from user input. Bound every text or collection that comes from the interface.
- **Back-end logic** lives in `src-tauri/src/domaine/`, in functions that take a `&Connection`; Tauri commands stay thin. Do not add permissions to `src-tauri/capabilities/default.json`: system access (dialogs, opening files) is done in Rust.
- **Schema changes** are new migrations only; never edit an existing one ([`src-tauri/migrations/README.md`](src-tauri/migrations/README.md)).
- **User-facing text is in French**, including error messages returned by the back end, which are displayed as they are. Code identifiers and comments are in French too; follow the surrounding code.
- **Tests come with behaviour changes**: Rust tests for business rules and migrations, Vitest tests for front-end logic, an end-to-end scenario when the change is visible in the interface.
- Update the documentation that describes what you changed: [`docs/specification.md`](docs/specification.md) for business rules and the contract, [`CHANGELOG.md`](CHANGELOG.md) for user-visible changes, and the relevant README.

## Reporting a security issue

Do not open a public issue for a vulnerability. Follow [`SECURITY.md`](SECURITY.md).

## Licence

INVENTORY is distributed under the GNU General Public License, version 3 only (`GPL-3.0-only`, see [`LICENSE`](LICENSE)). By contributing, you agree that your contributions are licensed under the same terms.
