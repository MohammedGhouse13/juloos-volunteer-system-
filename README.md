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
- `MAX_UPLOAD_MB=10`

### Existing database migration
This version automatically migrates the `volunteers`, `batches`, and `audit_logs` tables at startup. It is specifically compatible with older database schemas and adds missing columns such as `mobile` before creating indexes.

### Fresh Blueprint deployment
The included `render.yaml` can create a web service and PostgreSQL database together via Render Blueprint. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` when prompted.

## Features
- Live browser camera capture for volunteer photo; gallery selection is not accepted for the live-photo field.
- Aadhaar number capture and secure administrator-only review. No Aadhaar document upload, OCR, or automatic matching is performed.
- Duplicate Aadhaar and mobile checks.
- Admin login, dashboard, volunteer database, search, approval/rejection, batch assignment, audit logging and ID cards.
- Full Aadhaar is encrypted at rest and masked by default. Authorized reveal/document viewing is logged.
- QR code contains only a volunteer verification URL, never Aadhaar data.

## Important
The camera capture is not biometric anti-spoofing. It only ensures the volunteer captured a photo through the browser camera rather than selecting a gallery file.

Do not commit `.env` files or real Aadhaar numbers to GitHub.


## Approval workflow
Registrations are NEVER automatically approved. Every registration starts as SUBMITTED and must be reviewed by an administrator. The administrator can APPROVE or REJECT it. Rejected records and their uploaded documents are retained; nothing is deleted by the rejection action. An ID card can only be generated after approval, and the volunteer can open it from the public status page using their Volunteer ID.

No Aadhaar document is uploaded or stored by new registrations. The application stores the Aadhaar number securely for authorized administrator review and does not perform OCR or automatic matching.
