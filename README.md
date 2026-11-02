# Case Log (server-free version)

A surgical case log for residents in Israel, tracked against an IMA residency syllabus: urology
(2022, v2.0), general surgery 2022 (skills-based) or general surgery 2008 (v1.0), chosen at first
open and shared by a resident's paired devices. It runs entirely in the browser as an installable web app; cases are kept in
the device's storage (IndexedDB) and synced between one person's devices through an end-to-end
encrypted relay.

- **SETUP.md**: one-time setup of the relay (Cloudflare) and hosting (GitHub Pages).
- **FRIENDS.md**: what to send people who'll use it.

## How sync works

Pairing creates a random 32-byte secret on the first device. From it each device derives (HKDF-SHA-256)
an AES-256-GCM key, an anonymous room ID and an access token. The secret is shown only as a QR code
or pairing code, and moves between devices by scanning or pasting; it's never sent to the relay.

Changes are encrypted on the device and posted to the room as batches. Other devices fetch batches
they haven't seen, decrypt them and merge each case by last change wins (deletions are kept as
markers so they sync too). The relay (`relay/worker.js`, a Cloudflare Worker with a D1 database)
stores the ciphertext, the room ID and a hash of the token. It can't read cases, and the first
device to write to a room claims it, so a room can't be written to without the token.

## Files

| File | What it does |
| --- | --- |
| `index.html`, `style.css`, `app.js` | The app's screens |
| `local.js` | Storage, case rules, CSV import and export |
| `sync.js` | Pairing, encryption and sync |
| `syllabus.js`, `gs2022.js`, `gs2008.js` | Each syllabus: categories, targets per role, procedures |
| `syllabi.js` | The list of syllabi and the counting rules they share |
| `exports.js`, `xlsx.js` | The IMA Excel workbook |
| `config.js` | The relay's address |
| `sw.js`, `manifest.webmanifest` | Offline use and installing to the home screen |
| `vendor/` | QR code drawing (qrcode-generator, MIT) and scanning (jsQR, Apache-2.0) |
| `relay/` | The relay: Worker code, database tables, and a `wrangler.toml` for deploying from the command line |

## Deploying the relay from the command line

Instead of the dashboard steps in SETUP.md:

```sh
cd relay
npx wrangler d1 create caselog-relay        # put the printed database_id in wrangler.toml
npx wrangler d1 execute caselog-relay --remote --file=schema.sql
npx wrangler deploy
```
