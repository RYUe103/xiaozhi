# SanSuo Data Management

This project keeps user data account-scoped:

- User conversations, messages, sessions, files, local memories, and SanSuo file gateway records are stored in MongoDB.
- User-uploaded source files are kept under `uploads/<userId>/` and are treated as permanent unless an admin deletes that user's data.
- Sandbox temporary run directories under `sandbox/codeapi-data/runs` and upload leftovers under `sandbox/codeapi-data/tmp` are cleaned automatically after 7 days by `sandbox/code-api-server.js`.
- Assistant-generated output files use LibreChat file records with `context: "execute_code"`. Admins can preview and clean these globally with 30, 90, or 180 day retention.

## Admin Export And Delete

All endpoints require an admin JWT.

```bash
LOGIN_JSON=$(curl -s -H 'Content-Type: application/json' \
  -d '{"email":"Sansuo@Super","password":"YOUR_ADMIN_PASSWORD"}' \
  http://127.0.0.1:3080/api/auth/login)

TOKEN=$(node -e 'const j=JSON.parse(process.argv[1]); console.log(j.token || j.accessToken || "")' "$LOGIN_JSON")
USER_ID="<target-user-id>"
```

Preview one user's stored data:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:3080/api/admin/sansuo-data/users/$USER_ID/summary"
```

Export one user's metadata and chat data as JSON:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:3080/api/admin/sansuo-data/users/$USER_ID/export" \
  -o "sansuo-user-$USER_ID.json"
```

Binary uploads are not zipped by this endpoint. Copy `uploads/<userId>/` together with the exported JSON for migration.

Dry-run before deletion:

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:3080/api/admin/sansuo-data/users/$USER_ID/delete-preview"
```

Delete the user's chats, messages, files, memories, sessions, SanSuo file records, upload directory, and EverOS memories:

```bash
curl -X DELETE -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:3080/api/admin/sansuo-data/users/$USER_ID?confirm=DELETE_USER_DATA"
```

Optional flags:

- `deleteAccount=true`: also delete the user account.
- `deleteFiles=false`: keep the user's `uploads/<userId>/` directory.
- `deleteEverOS=false`: skip EverOS memory deletion.

## Output File Retention

Preview assistant output files older than 30, 90, or 180 days:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:3080/api/admin/sansuo-data/retention/outputs-preview?outputDays=90"
```

Clean expired assistant output files after checking the preview:

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:3080/api/admin/sansuo-data/retention/cleanup-outputs?outputDays=90&confirm=CLEANUP_EXPIRED_OUTPUTS"
```

This cleanup only targets `context: "execute_code"` assistant output files. It does not delete original user uploads.
