# Privacy Policy

Effective date: 2026-04-30

## Overview
WCL Combat-Time DPS Toggle (the "Extension") is a browser extension that recalculates DPS/WDPS/HPS display values on Warcraft Logs report pages using combat-time logic.

The Extension is designed to be privacy-first:
- No account system
- No analytics or tracking SDK
- No external backend service
- No sale or sharing of personal information

## Data We Collect
The Extension does **not** collect personal information.

The Extension only stores minimal preference data via `chrome.storage.sync`:
- `enabled`: whether combat-time recalculation is enabled
- `position`: floating widget position on the page

This preference data is used only for extension functionality.

## Where Data Is Processed
- Processing happens locally in your browser while viewing Warcraft Logs pages.
- The Extension reads page data needed for calculation only on matching URLs:
  - `*://*.warcraftlogs.com/reports/*`
- The Extension does not transmit report contents or personal data to any third-party server.

## Permissions
- `storage`: used to save extension preferences (`enabled`, `position`).

## Data Sharing
The Extension does not sell, rent, or share user data with third parties.

## Data Retention and Deletion
- Preference data remains in browser extension storage until you change it or uninstall the Extension.
- Removing the Extension removes its local/synced extension data according to browser behavior.

## Security
The Extension uses standard browser extension mechanisms and does not run a custom remote data pipeline.

## Children's Privacy
The Extension is not directed to children under 13 and does not knowingly collect children's personal data.

## Changes to This Policy
This policy may be updated when extension behavior changes. The latest version will be published with the project.

## Contact
For privacy questions, please open an issue in the project repository.
