# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-05-12

### Added
- Initial public release.
- **Bumper**: weekly cycle that scrapes every active listing, deletes it, and reposts it identically (title, body, price, location, photos, phone-hidden preference).
- **Prospect Watch**: weekly scan of leboncoin demands using `/finder/search`, with a regex-based scoring engine and a `seenIds` dedup index.
- Popup UI with two tabs (Bumper / Prospects), persistent settings in `chrome.storage.local`.
- Node-only test suite covering the scoring logic, dedup behaviour, and regex regressions.
- MIT license + ToS disclaimer.
