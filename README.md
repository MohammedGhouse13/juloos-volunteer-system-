# Juloos Volunteer Management System

A self-contained Node.js + PostgreSQL volunteer portal designed for Render.

## Included

- Mobile-first public registration
- Camera-only live-photo capture (no gallery picker)
- Aadhaar image/PDF upload
- Server-side OCR and strict Aadhaar-number comparison
- Registration is NOT created when the OCR-readable Aadhaar number does not match
- Duplicate Aadhaar/mobile detection
- Encrypted Aadhaar storage (AES-256-GCM)
- Masked Aadhaar in normal admin lists
- Authorized full-Aadhaar reveal with audit log
- Admin login
- Dashboard and searchable volunteer database
- Batch creation and assignment
- Sequential registration numbers
- Volunteer IDs
- Approval/rejection workflow
- Printable volunteer ID cards
- Local QR generation and public ID verification
- PostgreSQL persistence for volunteer photos/documents

## Deploy on Render

The included `render.yaml` is a Blueprint that creates a web service and PostgreSQL database.

If deploying manually, create a Render PostgreSQL database and set:

- `DATABASE_URL`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `SESSION_SECRET`
- `DATA_ENCRYPTION_KEY`
- `NODE_ENV=production`
- `OCR_ENABLED=true`
- `MAX_UPLOAD_MB=10`
- `BASE_URL=https://YOUR-SERVICE.onrender.com`

The app creates its tables automatically on startup.

## Important security notes

1. Do not commit `.env` or real Aadhaar documents.
2. Keep the GitHub repository private.
3. Keep `DATA_ENCRYPTION_KEY` stable after real records are stored. Changing it makes existing encrypted Aadhaar values unreadable.
4. The app uses PostgreSQL `bytea` for uploaded documents, so files persist with the database instead of Render's ephemeral web-service filesystem.
5. Normal admin screens show only masked Aadhaar.
6. The live-photo flow captures from the browser camera and does not accept a normal file picker. This is a capture-control, not a biometric anti-spoof guarantee.
7. OCR matching verifies that the uploaded document contains the same number the volunteer entered. It is NOT official UIDAI authentication.
8. For large-scale production, use an appropriate secure object-storage and identity-verification architecture after reviewing applicable privacy/legal requirements.

## First login

Use the values you set for:

`ADMIN_EMAIL`

and

`ADMIN_PASSWORD`

There is no hard-coded admin password.

## Health check

`/health`

## Public ID verification

`/verify/SDI-JUL-26-000001`
