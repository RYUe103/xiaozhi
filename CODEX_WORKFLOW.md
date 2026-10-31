# Codex Workflow

Use this workflow for future Codex sessions in this project.

## 1. Read Context First

Before proposing or changing code, read:

- `AGENTS.md`
- `TASK.md`
- `CODEX_WORKFLOW.md`
- `README.md`
- Relevant source files for the requested area
- Runtime logs/database records when the issue is runtime-dependent

Do not skip source reading. Before editing, inspect the exact files and call paths related to the requested change.

For runtime issues, also inspect as needed:

```bash
docker ps
docker logs LibreChat --since 10m
docker exec chat-mongodb mongosh LibreChat --quiet
curl -I http://127.0.0.1:3080/
curl -I http://127.0.0.1:3095/
curl -sS http://127.0.0.1:5055/health
```

## 2. Restate Understanding Before Edits

Before modifying code, Codex should summarize:

- Current project structure relevant to the task.
- The user's goal.
- Known constraints.
- Files likely involved.
- Proposed minimal change plan.
- What will not be changed.

Wait for user confirmation before editing when the user asks for planning, review, or explicitly says not to change code yet.

For this repository, prefer the following pattern before any business-code edit:

1. Read `AGENTS.md`, `TASK.md`, `README.md`, and the relevant source.
2. Restate understanding of the project structure, goal, constraints, and minimal plan.
3. Wait for confirmation.
4. Only then edit code.

## 3. Make Minimal Changes

- Keep edits tightly scoped.
- Prefer existing project patterns and helper functions.
- Do not add dependencies unless the user explicitly approves.
- Do not rename existing public functions, routes, files, database fields, or API shapes without explicit approval.
- Do not use prompt changes to mask broken engineering paths.
- Do not modify unrelated files.
- Avoid large-scale refactors when a local fix is enough.

## 4. Verify

After edits, run the smallest useful verification:

- Syntax check for edited JS files:

```bash
node --check path/to/file.js
```

- Frontend checks when UI changes:

```bash
npm run frontend:dev -- --host 127.0.0.1 --port 3095
npm run test:client
```

- Backend checks when API/runtime changes:

```bash
docker restart LibreChat
docker logs LibreChat --since 5m
curl -I http://127.0.0.1:3080/
```

- Sandbox checks when code-api changes:

```bash
curl -sS http://127.0.0.1:5055/health
tail -n 100 logs/sansuo-code-api.log
```

If a check is too expensive or cannot be run, state that clearly.

## 5. Report Results

After work, Codex should report:

- Files changed.
- Why each file changed.
- How to run the project or verify the change.
- Any risk points or compatibility concerns.
- Tests/checks run.
- Tests/checks not run.

Also state clearly whether the change should affect existing behavior outside the requested scope.

## 6. Git Policy

- Do not auto-commit.
- Do not create branches unless asked.
- Do not run destructive Git commands.
- Commit only when the user explicitly requests a commit.

## 7. Task Hygiene

- When the active task changes, update `TASK.md` before doing deeper implementation work.
- If the repository already contains guidance documents, extend them instead of overwriting them.
- If the user asks for documentation-only work, do not change business logic in the same task.
