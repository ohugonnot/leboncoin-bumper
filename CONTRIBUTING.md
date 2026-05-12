# Contributing

Thanks for considering a contribution.

## What's most valuable

1. **Selector fixes** — when leboncoin redesigns a page, the bumper breaks. Patches that update DOM selectors in `orchestrator.js` are merged fast.
2. **New scoring keywords or regex tweaks** — open a PR with a test in `tests/prospect.test.js` proving the change does what it claims.
3. **UX polish** of the popup — accessibility, dark mode, mobile-friendly layout.
4. **Bug reports** with a reproduction (which Chrome version, which leboncoin page, console logs).

## Setup

```bash
git clone https://github.com/ohugonnot/leboncoin-bumper.git
cd leboncoin-bumper
npm test     # 18 tests, no deps
```

Load the unpacked extension from `chrome://extensions` (Developer mode → Load unpacked).

## Code style

- Modern ES modules everywhere (`import` / `export`).
- No build step; the files are loaded as-is by Chrome.
- No external runtime dependencies. Tests use Node's built-in `node:test`.
- Wrap public functions with JSDoc. Pure logic must be testable in Node — keep `chrome.*` calls out of helpers.

## Testing your changes manually

1. After editing, reload the extension on `chrome://extensions`.
2. **If you changed `manifest.json` (especially `host_permissions`)**, a soft reload won't re-grant new permissions. Click **Remove** then **Load unpacked** again — or use `chrome.runtime.reload()` from the extension's service-worker DevTools.
3. Test the bumper first in **Dry-run** mode with a single listing ID.

## Pull requests

- Branch off `main`.
- One feature/fix per PR.
- Add or update tests when changing scoring logic, dedup behavior, or regexes.
- Update `README.md` if you change user-visible behavior.

## Reporting a leboncoin breakage

Paste in the issue:

1. The action that failed (which button you clicked).
2. The exception message from the service-worker DevTools (`chrome://extensions` → "service worker" link on the extension card).
3. The current URL of the tab being driven.
4. A snippet of the DOM around the broken selector (right-click → Inspect on the offending element, paste the outer HTML).

## Security & ToS

This extension automates a third-party site. Be mindful:
- Don't propose features that increase detection risk (mass-account loops, rate-busting).
- Don't add telemetry or third-party scripts.
- Never commit personal data (`backups/` is `.gitignore`d for a reason).
