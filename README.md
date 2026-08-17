# Juloos Volunteer Management System

Production-oriented Node.js/Express/PostgreSQL volunteer registration portal.

## Render deployment

### Existing Render web service
Use:
- Build: `npm install`
- Start: `npm start`
- Node: 20.20.2 (via `.nvmrc`)

Environment variables:
- `DATABASE_URL` — Render PostgreSQL Internal Database URL
- `ADMIN_EMAIL` — administrator email
- `ADMIN_PASSWORD` — administrator password
- `SESSION_SECRET` — long random secret
- `DATA_ENCRYPTION_KEY` — long random secret used to encrypt Aadhaar numbers
- `NODE_ENV=production`
- `OCR_ENABLED=true`
- `MAX_UPLOAD_MB=10`

### Existing database migration
This version automatically migrates the `volunteers`, `batches`, and `audit_logs` tables at startup. It is specifically compatible with older database schemas and adds missing columns such as `mobile` before creating indexes.

### Fresh Blueprint deployment
The included `render.yaml` can create a web service and PostgreSQL database together via Render Blueprint. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` when prompted.

## Features
- Live browser camera capture for volunteer photo; gallery selection is not accepted for the live-photo field.
- Aadhaar document upload and strict OCR number comparison against the entered 12-digit Aadhaar number.
- Duplicate Aadhaar and mobile checks.
- Admin login, dashboard, volunteer database, search, approval/rejection, batch assignment, audit logging and ID cards.
- Full Aadhaar is encrypted at rest and masked by default. Authorized reveal/document viewing is logged.
- QR code contains only a volunteer verification URL, never Aadhaar data.

## Important
The camera capture is not biometric anti-spoofing and OCR matching is not official UIDAI authentication. Do not describe the system as UIDAI authentication unless an authorized UIDAI service is actually integrated.

Do not commit `.env` files or real Aadhaar documents to GitHub.
