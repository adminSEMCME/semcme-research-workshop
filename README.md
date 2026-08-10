# SEMCME Research Workshop Series

Protected SEMCME Research Workshop Series site with SBS-style magic-link login, Constant Contact registration lookup, saved original Research Workshop content, and an admin editor.

## What Is Built

- Express/Node production app.
- 24-hour participant sessions with 15-minute one-use sign-in links.
- Constant Contact lookup by Research Workshop Series event ID and track key.
- PostgreSQL tables namespaced with `rws_*`.
- Staff admin page at `/admin` for editing workshop sections, links, videos, PDFs, and materials.
- Saved original Research Workshop content with 46 resources captured from the old SEMCME Research Workshop page.
- Admin-managed workshop content with section/resource ordering.
- Search by word and multi-section filtering.
- Resource panels with embedded YouTube/Vimeo/video links where possible.

## Setup

1. Copy `.env.example` to `.env` and fill in production values.
2. Install dependencies with `npm install`.
3. Run the database schema with `npm run db:migrate`.
4. Start locally with `npm start`.

## Admin

Set `GLOBAL_ADMIN_USERNAME` and `GLOBAL_ADMIN_PASSWORD`, then visit `/admin`.

The admin page can:

- Import the saved original Research Workshop content into editable database rows.
- Add, edit, hide, delete, and reorder sections.
- Add, edit, hide, delete, and reorder videos, links, PDFs, and materials.
- Update the member-facing workshop site immediately after a save.

## Production Notes

- Set `APP_BASE_URL` to the final deployed URL before sending emails.
- Set `COOKIE_SECURE=true` and `TRUST_PROXY=true` behind a production proxy.
- Add `CONSTANT_CONTACT_RWS_EVENT_ID` once the Constant Contact campaign is ready. `CONSTANT_CONTACT_RWS_TRACK_KEY` is optional when the event has a single registration track.
- Use `SMTP_HOST=smtp.resend.com`, `SMTP_PORT=587`, `SMTP_SECURE=false`, `SMTP_USER=resend`, and a Research Workshop Series Resend API key as `SMTP_PASS`.
- Without SMTP settings, sign-in links are logged to the server console for local testing.
- You can reuse an existing SEMCME Postgres database. This project uses `rws_` table names to avoid conflicting with the other sites.

## Workshop Content

The app ships with the saved original Research Workshop Series content, then uses admin-edited database rows once the original content has been imported or customized. Production does not depend on the old SEMCME WordPress page.
