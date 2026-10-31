# SanSuo Visual Context Persist Fix

## What Changed

- Current-request sandbox file context now builds DOCX/PDF visual context on a clone without persisting that clone to MongoDB.
- The real user message is the only current-request message that attempts visual-context persistence.
- DOCX/PDF visual context is cached per request by attachment identity, so the same file batch is not parsed twice in one request.
- Success logs are emitted only after `db.updateMessage` succeeds.
- Failed persistence is still non-fatal: the current request can answer with the in-memory visual context, but follow-up recovery may depend on persistence success.

## Expected Healthy Log Flow

For one PDF upload, a healthy request should look like this:

```text
[SanSuoMain] PDF visual context start
[SanSuoMain] PDF visual output files
[SanSuoMain] PDF visual pack parsed
[SanSuoMain] PDF visual context appended
[SanSuoMain] visual context persist deferred by caller
[SanSuoMain] file context after visual append
[SanSuoMain] persisted visual context: current document visual context on user message
[SanSuoMain] injected sandbox file context into current request
```

If the same attachment batch is encountered again inside the same request, it should not rerun PDF parsing:

```text
[SanSuoMain] PDF visual context reused from request cache
```

## Logs That Should Disappear

These old misleading logs should not appear after this patch:

```text
[SanSuoMain] failed to persist visual context after append
[SanSuoMain] persisted visual context after append
[SanSuoMain] failed to persist current document visual context
[SanSuoMain] persisted document visual context on user message
```

## If Persistence Still Fails

Look for:

```text
[SanSuoMain] failed to persist visual context: current document visual context on user message
```

This means PDF/DOCX visual context was generated, but the user message could not be updated in MongoDB. Common causes:

- The message has not been saved yet.
- The `messageId` does not match a saved message.
- The current login user does not match the saved message owner.
- The user switched conversations, refreshed, or cancelled while the request was still running.

The model may still answer the current request because the context is in memory, but a later follow-up may not recover the context unless persistence succeeds.

