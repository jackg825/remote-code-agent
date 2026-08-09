# Remote Code Agent: AI Agent Guide

This file is for AI agents only. Human deployment and operating instructions are maintained in [`README.md`](README.md).

## Scope

When modifying code, validating locally, deploying to Cloudflare, performing post-deployment acceptance, or diagnosing this repository, follow this file first and then read the relevant README sections. Unless the user explicitly requests it, do not expand an inspection or diagnosis into a deployment, external-resource creation, or existing-infrastructure change.

This project uses only Cloudflare Workers, Static Assets, Tunnel, and Access. Do not create Firebase, Firestore, or other database resources.

## Reading order

1. Read the README sections [Architecture and security model](README.md#architecture-and-security-model) and [Secrets and personal data](README.md#secrets-and-personal-data).
2. Inspect `wrangler.jsonc`, `.gitignore`, `package.json`, and the source files relevant to the task.
3. Before deploying the backend, read the installer for the target operating system:
   - Linux: `scripts/install-user-service.sh`
   - macOS backend: `scripts/install-macos-service.sh`
   - macOS Tunnel: `scripts/install-macos-tunnel-service.sh`
4. For deployment or acceptance work, follow the README in order from [Prerequisites](README.md#prerequisites) through [8. Verify the complete path](README.md#8-verify-the-complete-path).
5. To validate real user behavior, read [Mobile usage](README.md#mobile-usage), [AI coding-agent modes](README.md#ai-coding-agent-modes), [Mobile file uploads](README.md#mobile-file-uploads), and [Multiple persistent sessions](README.md#multiple-persistent-sessions).

## Required information before deployment

The user must specify or confirm all of the following. Never infer production values from examples:

- Target instance and operating system
- `PUBLIC_HOSTNAME`
- `ORIGIN_HOSTNAME`
- `ACCESS_TEAM_DOMAIN`
- `ACCESS_AUD` for the public-entry Access application
- `WORKSPACE_DIR`
- Cloudflare account and the Tunnel name to create or reuse
- Email addresses, groups, or IdP identities allowed through the public entry point

If a choice changes resource ownership, the security boundary, or cost, and the local or Cloudflare state does not make the answer safe to infer, explain what is missing and ask the user to decide.

## General development and validation

Before editing, understand the current behavior and inspect the worktree. Preserve existing user changes. Make the smallest complete change for the task and run the narrowest meaningful verification.

Full local verification:

```bash
npm ci
npm run check
```

Local development requires two long-running processes:

```bash
# Terminal 1
npm run dev

# Terminal 2
npm run dev:cloudflare
```

README deployment commands are documentation, not deployment authorization. Do not deploy or create Cloudflare resources without an explicit user request.

## Deployment workflow

After receiving an explicit deployment request, proceed in this order:

1. List the backend service, Tunnel, hostnames, Access applications, Worker, and custom domain that will be created or changed so the user can verify the scope.
2. Run `npm ci && npm run check`.
3. Install the backend, confirm that it listens only on `127.0.0.1`, and verify the loopback `/healthz` endpoint.
4. Create or reuse the dedicated Tunnel specified for this task. Do not modify another existing Tunnel.
5. Have the user complete both identity-sensitive Access applications and least-privilege policies.
6. Copy `wrangler.jsonc` to the Git-ignored `wrangler.production.jsonc` and enter only confirmed production settings.
7. Write Worker secrets through the interactive `wrangler secret put` prompt.
8. Run `npm run deploy:dry-run`; only after it succeeds, run `npm run deploy:cloudflare`.
9. Validate backend → Tunnel → origin Access → public Access → Worker → WebSocket → tmux reconnect, in that order.
10. Inspect ignored files, the staged diff, and secret-scan results to confirm that no private file or secret can enter Git.

## Steps that require human control

Stop and clearly tell the user what they must complete when a step involves any of the following. Never ask the user to paste a secret into the conversation:

- Cloudflare, IdP, Claude Code, or Codex sign-in and MFA
- An Access Client Secret or Tunnel connector token shown only once
- Secret entry for `wrangler secret put`
- Email, group, or identity selection for an Access allow policy
- Administrator privileges or changes to resources outside the task scope

After the user finishes, continue with status and behavior checks that do not reveal the secret.

## Usage and acceptance

A successful deployment is not complete user acceptance. Follow [8. Verify the complete path](README.md#8-verify-the-complete-path) and verify:

1. The instance loopback health check succeeds.
2. The origin rejects requests without the service token instead of returning backend `200`.
3. The public hostname redirects unauthenticated users to Access or rejects them.
4. The Tunnel connector reports `Healthy`.
5. After signing in from a phone, the user can run a shell, start Claude Code or Codex, use control keys, and open external URLs.
6. Closing and reconnecting to the page preserves the original tmux session.
7. If the task includes uploads, multiple sessions, or permission modes, verify each corresponding README behavior separately.

When a check requires the user's browser session or physical interaction, provide exact steps and ask them to report the result. Never claim success for a check that was not performed.

## Success criteria

- The backend listens only on `127.0.0.1`, and the instance exposes no inbound port.
- The public hostname serves the frontend through a Cloudflare Worker and is protected by the user Access policy.
- The origin hostname is reached through Cloudflare Tunnel and accepts only the Worker's Service Auth token.
- A phone can operate a real tmux PTY, and reconnecting preserves the session.
- `npm run check` and `npm run deploy:dry-run` succeed.
- No secret, private production configuration, or deployment-identifying data enters Git or the response.

## Security constraints

- Never print, log, commit, or return a password, API token, Tunnel token, Access Client Secret, Claude/Codex credential, email address, real domain, account ID, or AUD.
- Production values belong only in the Git-ignored `wrangler.production.jsonc`. Never use `git add -f` for a private file.
- Worker secrets must be entered only through the interactive `wrangler secret put` prompt. Never place a secret in a command argument, shell history, documentation, or source code.
- Do not modify an unrelated Tunnel, DNS record, Access policy, Worker, service, or user file.
- Do not weaken loopback binding, origin Service Auth, or the public Access policy to troubleshoot a connection.

Before committing or handing off, run at least:

```bash
git status --short --ignored
git diff --cached
git grep --cached -n -I -E 'BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|[[:xdigit:]]{32}\.access|gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}' -- .
```

The final command should print nothing.

## Reporting format

After deployment or acceptance, report only:

- Names of resources created or changed, without IDs, real hostnames, or secrets
- Success, failure, or waiting-for-user status for each layer
- Tests actually run and their results
- Unverified risks and the next required action

Never reproduce production configuration or sensitive CLI output in the report.
