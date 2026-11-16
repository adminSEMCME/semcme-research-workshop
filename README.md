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

## Resource files and annual registration campaign

In admin Step 3, choose **Link** or **Upload file**. Uploads accept PDF, DOCX,
PPTX, XLSX, TXT, PNG, and JPG files up to 20 MB. Use a link for videos and larger
files. Files are stored in PostgreSQL with the resource, so they survive server
restarts and Vercel deployments without a separate storage service. Downloads
require member access (or admin login); hidden resources are available only to
admins. Editing a title keeps the attachment. Selecting a new file replaces it;
switching to a link, deleting its resource/section, or resetting workshop content
removes the attachment.

Use **Constant Contact registration campaign** in admin to set the event ID,
optional registration track key, and public registration URL. The event must
already exist in the connected Constant Contact account. The event ID identifies
an event with registrants, not an email marketing campaign. Leave the track key
blank to discover the event's tracks. The server verifies registration-list access
before saving. Environment values remain the defaults until an admin saves settings.
No deployment or environment-variable change is needed for subsequent switches.

Saving a campaign forces existing users to revalidate on their next protected
request/sign-in, including previously issued sign-in links. Prior-year users need
registration in the newly selected event. User history remains in the admin table;
Sync users imports the new event's registrants. The member-facing availability-year
sentence is still site copy in `index.html`; update it when the announced access
period changes.

Schema additions are applied automatically on the next database-backed request,
or explicitly with `npm run db:migrate`. `npm test` uses an isolated in-memory
PostgreSQL-compatible database and mocked Constant Contact responses; it does not
connect to production. Run `npm run check` for JavaScript syntax checks.

Uploads transfer in 2 MB chunks to stay below Vercel's per-request payload limit.
Incomplete uploads expire after one day and are cleaned up on the next upload;
the client also removes them after a failed save. Files larger than 3 MB open a
protected download page, which assembles authenticated chunks in the browser and
provides a Save file link. Every chunk checks access and the file version, so a
replacement cannot silently mix old and new file contents. No additional storage
account or environment variables are needed.
