# Repository Guidelines

This project is a ide design for android, also support desktop for development and testing.

## Project Structure & Module Organization

`src/` contains the React 19 front end; keep UI elements in `src/components/`, route-level views in `src/pages/`, reusable logic in `src/lib/`, and shared types in `src/types/`. Styles live in `src/index.css` alongside Tailwind utility layers, while static assets are under `src/assets/`. The desktop runtime code is in `src-tauri/`, where `src-tauri/src/*.rs` hosts the Tauri commands (`projects.rs`, `terminal.rs`, `fs_utils.rs`). The companion `tauri-plugin-toast/` workspace packages the custom toast plugin; treat it as a first-class crate when editing plugin behavior.

## Build, Test, and Development Commands

Use Yarn v4 in corepack mode; run commands with `yarn <script>` so they resolve through the zero-install `.yarn/` directory. `yarn dev` starts the Vite dev server for the web UI. `yarn tauri dev` launches the Tauri shell with hot reloading for both Rust and React. `yarn build` runs `tsc` type checking followed by a production Vite bundle. `yarn preview` serves the built assets for quick smoke tests. `yarn tauri build` produces desktop installers; run this from a clean tree to avoid leaking experimental binaries.

## Coding Style & Naming Conventions

Rely on Prettier defaults (`yarn prettier --write src`) for formatting(frontend part); the project expects 2-space indentation, single quotes in TSX, and trailing commas where valid. Favor functional React components with PascalCase filenames (`ProjectList.tsx`) and colocate component-specific styles or hooks next to their implementation. TypeScript generics and shared shapes live in `src/types/` and should be exported with camelCase names. Tailwind utility classes belong in JSX; extract shared patterns into `cn()` helpers when they grow repetitive.

## Commit & Pull Request Guidelines

Follow the Conventional Commit style used in history (`feat: 优化预览面板并引入等待动画`). Keep the type short (`feat`, `fix`, `refactor`) and the summary concise; Chinese summaries are welcome. Each PR should describe the user-visible outcome, list testing performed (`yarn dev`, `yarn tauri build`, etc.), and reference related issues. Attach screenshots or recordings when UI changes affect layout or motion, and tag reviewers responsible for the touched modules.
