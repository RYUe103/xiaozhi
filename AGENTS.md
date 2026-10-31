# Codex Project Rules

Existing reference: `CLAUDE.md`.

This file records long-lived rules for Codex/agent work in this repository. Read it before changing code.

## Project Background

This project is based on LibreChat v0.8.5 and is being adapted into an internal enterprise assistant named SanSuoMain / 三所助手 / 三所智联.

Primary product goals:

- Stable ChatGPT-like chat experience for internal users.
- Chinese-first interface and behavior.
- Default assistant/model experience centered on SanSuoMain and Qwen3-VL.
- Native Qwen3-VL image understanding for image description and screenshot analysis.
- Sandbox/OpenSandbox-based processing for non-image files, code execution, precise calculation, file conversion, chart generation, and downloadable outputs.
- Reliable preservation of Chinese filenames.
- Controlled long-term memory through EverOS, without saving ordinary temporary tasks as stable memory.
- Project/folder sidebar behavior close to ChatGPT Projects.

## How Codex Should Work Here

- Before changing any code, first read `AGENTS.md`, `TASK.md`, `CODEX_WORKFLOW.md`, `README.md`, and the relevant source files for the task.
- Keep changes as small as possible. Prefer local fixes over broad refactors.
- Do not add dependencies unless the user explicitly asks for them.
- Do not rename public APIs, routes, file paths, function names, or data structures unless the user explicitly approves it.
- Do not guess when logs, runtime state, or source inspection can answer the question.
- After finishing, always explain which files changed, why they changed, how to run or verify them, and whether any existing behavior may be affected.

## Important Directories

- `client/`: LibreChat frontend, React/Vite UI, chat page, sidebar, upload UI, message rendering.
- `api/`: LibreChat backend services, routes, auth, file handling, message and memory services.
- `packages/`: Shared LibreChat packages. Some runtime code may use built `dist` files.
- `patches/`: Runtime patch files mounted into the Docker container. Changes here can affect the running backend directly.
- `sandbox/`: SanSuo code-api, OpenSandbox integration, sandbox helpers, and generated sandbox data.
- `keycloak/`: Local Keycloak realm/import configuration for SSO testing.
- `librechat.yaml`: Main LibreChat configuration, model specs, SanSuoMain prompt and file settings.
- `docker-compose.yml` and `docker-compose.override.yml`: Local Docker runtime configuration.
- `logs/`: Local logs for frontend, sandbox, OpenSandbox, and related services.
- `uploads/` and `images/`: Local file storage mounted into the LibreChat container.

## Common Commands

Use the project root as the working directory unless noted otherwise:

```bash
pwd
docker ps
docker logs LibreChat --since 10m
docker exec chat-mongodb mongosh LibreChat --quiet
curl -sS http://127.0.0.1:5055/health
curl -I http://127.0.0.1:3080/
curl -I http://127.0.0.1:3095/
```

Frontend development:

```bash
npm run frontend:dev -- --host 127.0.0.1 --port 3095
cd client && npm run dev -- --host 127.0.0.1 --port 3095
```

Backend and runtime:

```bash
docker restart LibreChat
npm run sandbox:serve
npm run sandbox:opensandbox
```

Build, tests, and checks:

```bash
npm run build:data-provider
npm run build:data-schemas
npm run build:api
npm run build:client-package
npm run build:client
npm run test:client
npm run test:api
npm run lint
node --check path/to/file.js
```

Run only the checks relevant to the change when full test suites are too expensive. State clearly if a check was not run.

## Required Work Rules

- Before modifying code, read `AGENTS.md`, `TASK.md`, `CODEX_WORKFLOW.md`, `README.md`, and the relevant source files.
- Inspect the running state when the issue depends on runtime behavior: Docker mounts, Mongo records, backend logs, frontend state, sandbox logs, and actual HTTP responses.
- Do not rely on guesses when logs or database records can answer the question.
- Prefer minimal, localized changes. Avoid broad refactors unless explicitly requested.
- Do not make large architectural rewrites while fixing a narrow regression.
- Do not add new dependencies without explicit user approval.
- Do not silently change existing public interfaces, function names, file paths, route shapes, database fields, or attachment structures.
- Do not use prompt-only fixes to hide broken engineering paths.
- Preserve Chinese filenames and user-visible Chinese text unless a specific code path requires ASCII.
- Be careful with Docker-mounted runtime files. Source changes may not affect the running container unless the mounted or built file used at runtime is also updated.
- Never revert user changes or unrelated work unless the user explicitly asks.
- Do not run destructive Git commands.
- Do not auto-commit Git changes unless the user explicitly asks.

## Change Report Requirements

After any modification, report:

- Files changed.
- Why each file changed.
- How to run or verify the change.
- Whether existing behavior may be affected.
- Any tests/checks run, and any tests/checks not run.

## Sandbox Tool Capability Rules

- Do not invent tool names, command names, Python modules, or external APIs.
- Use only commands and Python packages confirmed by `capabilities.json` or by a real local detection script run.
- Run `python scripts/check_capabilities.py` after sandbox dependency changes to refresh `capabilities.json`.
- PDF conversion must go through the single entrypoint: `python scripts/convert_to_pdf.py input_path output_path`.
- Do not call or mention `convert_to_pdf`, `sansuo_tools`, `docx_to_pdf`, or similar names as external tools unless they are real local scripts or importable modules in the current environment.
- If a dependency is missing, state exactly what is missing and stop that conversion path.
- Do not repeatedly revise the plan after failures by guessing new tools. Inspect capabilities and choose a supported path.
- Do not say a file was generated unless the file exists and has non-zero size.
- After generating any file, verify that the output path exists and is non-empty before returning it to the user.
