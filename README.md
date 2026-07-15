# Quatt Sales Support Tool — Prototype

A single-file browser app that guides sales agents through qualification calls. No installation, no login — open `index.html` and go.

---

## What it does

The tool pulls deals from HubSpot and presents them as a live pipeline board. When a sales agent opens a deal, it automatically loads the right qualification playbook based on the product(s) attached to that deal. The agent follows the playbook step by step during the call, logs the outcome, and closes out — all without leaving the tool.

---

## Features

### Deal pipeline
- Shows all open deals grouped by pipeline stage
- Live data from HubSpot (or demo mode if no connection is configured)
- Click any deal card to open the call panel

### Qualification playbooks
Four built-in playbooks, one per product:

| Product | Playbook |
|---|---|
| Hybrid Single / Duo | Hybrid Kwalificatiegesprek |
| All-Electric | All-Electric Kwalificatiegesprek |
| Chill | Chill Kwalificatiegesprek |
| HomeBattery | HomeBattery Kwalificatiegesprek |

If a deal has multiple products (e.g. "Hybrid Single, Chill"), both playbooks appear as tabs and the agent can switch between them.

### Playbook structure
Each playbook walks through phases:
- **Opening** — recording consent script + Aircall note reminder
- **Inventarisatie** — intent chips, orientation notes, timing
- **Tech check** (Hybrid & All-Electric) — gas usage check and home suitability check, each with a compact outcome table and expandable agent scripts
- **Educatie & Positionering** (Chill) — scenario A or B based on what the customer already knows
- **Afsluiting** — address capture, agent name, call outcome

### Call outcome logging
At the end of every call the agent picks one of three outcomes:
- **Plan HV** — schedules a home visit
- **Long-term opportunity** — logs a note and a follow-up date
- **Lost** — selects a lost reason and logs a note

### Aircall integration
- Click-to-call directly from the deal panel
- Power Dialer compatible — the tool detects an active Aircall session and prefills context

### Admin panel
Accessible via the settings icon. Allows team leads to:
- Build custom playbooks without touching code
- Configure the HubSpot connection and field mappings
- Manage the call scheduler

### Other
- **Dark / light theme** toggle
- **NL / EN** language switch
- **Demo mode** — works fully offline with sample deals, useful for onboarding and testing

---

## How to use

1. Open `index.html` in any modern browser (Chrome recommended)
2. In demo mode, sample deals are pre-loaded — click any card to try the playbook
3. To connect to live HubSpot data, open the Admin panel (⚙️) and enter your HubSpot Private App token

---

## Status

This is an early prototype shared for internal feedback. Functionality is subject to change based on team input.

**Feedback?** Drop your notes in [channel / doc / form — add link here].
