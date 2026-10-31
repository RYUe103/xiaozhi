# SanSuo LDAP Auth Setup

This project already has LDAP login support through `passport-ldapauth`.

When both `LDAP_URL` and `LDAP_USER_SEARCH_BASE` are set, LibreChat switches `/api/auth/login` from local password auth to LDAP auth. Users still get local LibreChat user records for conversations, files, folders, and memories, but passwords are verified by the company LDAP/AD server.

## Runtime Flow

```text
Login page
  -> POST /api/auth/login
  -> LDAP strategy verifies username/password against AD/LDAP
  -> LibreChat creates or updates local user with provider=ldap
  -> LibreChat issues normal JWT/session tokens
```

## Parameters To Change For Company LDAP

Set these in `.env`:

```bash
LDAP_URL=ldaps://ad.company.local:636
LDAP_BIND_DN=CN=ldap-reader,OU=ServiceAccounts,DC=company,DC=local
LDAP_BIND_CREDENTIALS=replace-with-service-account-password
LDAP_USER_SEARCH_BASE=DC=company,DC=local
LDAP_SEARCH_FILTER=(sAMAccountName={{username}})
LDAP_LOGIN_USES_USERNAME=true
LDAP_ID=sAMAccountName
LDAP_USERNAME=sAMAccountName
LDAP_EMAIL=mail
LDAP_FULL_NAME=displayName
LDAP_TLS_REJECT_UNAUTHORIZED=true
LDAP_CA_CERT_PATH=/app/certs/company-ad-ca.pem
```

If the company allows UPN/email login instead of short usernames, use:

```bash
LDAP_SEARCH_FILTER=(userPrincipalName={{username}})
LDAP_LOGIN_USES_USERNAME=true
LDAP_ID=userPrincipalName
LDAP_USERNAME=userPrincipalName
LDAP_EMAIL=mail
LDAP_FULL_NAME=displayName
```

If the company LDAP only supports plaintext LDAP on an internal network, use `ldap://host:389`, but production should prefer `ldaps://host:636` or StartTLS.

## What To Ask IT/OA Team

Ask for:

- LDAP or LDAPS URL, including port.
- Base DN.
- Service account Bind DN.
- Service account password.
- User search base, if different from Base DN.
- Login field: usually `sAMAccountName` or `userPrincipalName`.
- Stable unique field: usually `sAMAccountName`, `objectGUID`, or `userPrincipalName`.
- Email field: usually `mail`.
- Display name field: usually `displayName` or `cn`.
- Whether LDAPS or StartTLS is required.
- CA certificate file if the LDAP server uses an internal CA.
- Allowed user scope, for example only a specific OU or group.

## Common AD Examples

Short username login:

```bash
LDAP_SEARCH_FILTER=(sAMAccountName={{username}})
LDAP_LOGIN_USES_USERNAME=true
```

Email/UPN login:

```bash
LDAP_SEARCH_FILTER=(userPrincipalName={{username}})
LDAP_LOGIN_USES_USERNAME=true
```

Mail login:

```bash
LDAP_SEARCH_FILTER=(mail={{username}})
LDAP_LOGIN_USES_USERNAME=false
```

Restrict to an OU:

```bash
LDAP_USER_SEARCH_BASE=OU=Users,OU=ThirdInstitute,DC=company,DC=local
```

## Current Project Notes

- `api/strategies/ldapStrategy.js` creates or updates users with `provider: 'ldap'`.
- `api/server/routes/auth.js` uses LDAP auth automatically when LDAP is enabled.
- `api/server/services/Config/ldap.js` tells the frontend whether to show username-style login.
- `ALLOW_REGISTRATION` is ignored when LDAP is enabled; registration is disabled.
- Enabling LDAP disables local password login on `/api/auth/login` in the current code path.
- Keep a tested admin recovery route or disable LDAP in `.env` temporarily if LDAP is unavailable.

## Local Verification

After changing `.env`:

```bash
docker restart LibreChat
curl -sS http://127.0.0.1:3080/api/config | jq '.ldap'
docker logs LibreChat --since 5m | grep -i ldap
```

Expected config when username login is enabled:

```json
{
  "enabled": true,
  "username": true
}
```

Then test login through the UI with a real domain account.

