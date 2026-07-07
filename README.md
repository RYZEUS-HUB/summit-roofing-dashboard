# Summit Roofing & Contracting — Live GHL Dashboard

This package keeps the same dashboard design and connects it to GoHighLevel through Netlify Functions.

## What is live

- Dashboard cards: revenue, leads, bookings, emergency matching, avg ticket
- Opportunities board from GHL pipelines/opportunities
- Calendar bookings from GHL calendar events
- Estimates/Invoices table from invoices, with opportunities fallback
- Reports charts from invoices/won opportunities
- Booking form: creates a GHL contact and, if calendar ID is set, an appointment

## Important security rule

Do not put your Private Integration Token in `index.html` or `assets/live-dashboard.js`.
Keep it in Netlify environment variables only.

## Required Netlify environment variables

Set these in Netlify dashboard or via Netlify CLI:

```bash
GHL_PRIVATE_TOKEN=your_private_integration_token
GHL_LOCATION_ID=OlquyHCRhKfTPGjTYZSW
GHL_API_VERSION=2021-07-28
```

Optional:

```bash
GHL_CALENDAR_ID=your_calendar_id
GHL_PIPELINE_ID=your_pipeline_id
GHL_DEFAULT_ASSIGNED_USER_ID=your_user_id
DASHBOARD_TIMEZONE=America/New_York
DASHBOARD_COMPANY_NAME=Summit Roofing & Contracting
DASHBOARD_DIVISION_NAME=Plumbing Division CRM
```

## Deploy on Netlify

### Recommended: Netlify CLI

```bash
npm install
npx netlify login
npx netlify link
npx netlify env:set GHL_PRIVATE_TOKEN "PASTE_TOKEN_HERE"
npx netlify env:set GHL_LOCATION_ID "OlquyHCRhKfTPGjTYZSW"
npx netlify env:set GHL_API_VERSION "2021-07-28"
npx netlify deploy --prod
```

### Test after deploy

Open:

```text
https://YOUR-SITE.netlify.app/.netlify/functions/health
https://YOUR-SITE.netlify.app/.netlify/functions/dashboard
```

If health says token missing, set environment variables and redeploy.
If health says unauthorized, the token or scopes are wrong.

## Required GHL scopes

Enable at least:

- locations.readonly
- contacts.readonly / contacts.write
- opportunities.readonly / opportunities.write
- calendars.readonly / calendars.write
- payments/invoices read scope if you want real invoice revenue

Scope names may appear slightly different in the GHL UI. Select matching read/write permissions for Contacts, Opportunities, Calendars, and Payments/Invoices.

## Files

- `index.html` — existing UI/design
- `assets/live-dashboard.js` — frontend live renderer
- `netlify/functions/dashboard.js` — reads live GHL data and maps it to dashboard
- `netlify/functions/create-booking.js` — creates contact/appointment/opportunity
- `netlify/functions/health.js` — quick connection test
- `netlify/functions/_lib/ghl.js` — shared GHL API helper
