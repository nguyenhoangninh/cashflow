# SVL Cashflow × ChatGPT — Integration & security

**Status:** GitHub feature-branch proposal. Does NOT establish a live ChatGPT data connection.
No service-account credentials, account numbers or authentication secrets should be added to this repository.

## Immediate functionality
Two buttons become available when a valid dataset is loaded:
- **Xuất AI tổng hợp**: daily/weekly balances, cashflow categories (totals only), and warnings.
- **Xuất AI chi tiết**: explicitly opts into a limited set of payment fields. Even this excludes names, account numbers and free-text notes.

The export is a browser-local JSON download only, triggered after user confirmation. There is **no automatic upload** to ChatGPT or any outside endpoint. The file contains confidential business figures; company authorization is still required before sharing.

## Important confidentiality issue
The public repository currently embeds historical actual financial figures in `src/structure.js`, including cashflow opening values. Public GitHub Pages JavaScript is visible to anyone. Do not add any more company financial information into the repository. Plan to move actual values to authenticated storage and remove sensitive data from Git history, existing static assets, caches and repository copies through a reviewed security remediation. Removing values in a new commit alone does not erase previous exposure.

## Why live ChatGPT queries still do not work
- `firebase-config.js` has `REPLACE_...` placeholders; the site runs in browser `localStorage` mode.
- GitHub permissions allow source-code changes, not arbitrary reads of a user's local browser data.
- A protected read-only MCP/HTTPS backend with per-user OAuth and Firestore permissions must be deployed separately.

## Recommended next phase (not in this PR)
1. Create a **corporate-owned Firebase** project. Enable Google sign-in and **role-based, least-privilege** Firestore rules. Firebase web config can be public; admin service-account secrets must be server-side only.
2. Securely import the company workbook into Firestore; test roles and access revocation.
3. Build a **read-only MCP server** with OAuth authorization, request scopes and server-side audit logs. Do not expose Firestore admin credentials to ChatGPT or GitHub Pages.
4. Only return explicitly requested, minimal data: balance, forecast, payment-status aggregates, bank reconciliation differences.
5. Validate calculations against original workbook, create production backups, and review compliance before enabling live AI access.

**Review and merge the PR deliberately; no changes to `main` or the production website are automatic.**
