# Juloos Volunteer Registration — Final Prototype

## Current workflow
Volunteer → Registration → PENDING → Admin Review → APPROVE/REJECT → Approved Volunteer ID → Reference-style printable ID card.

### Volunteer fields
- Full Name
- Age
- WhatsApp Number
- Emergency Contact Number
- Address / Place
- Aadhaar Number
- Aadhaar Card upload (JPG/PNG/WEBP/PDF)
- Profile Photo upload (JPG/PNG/WEBP)
- Consent

No gender field. No camera capture. No Aadhaar OCR or automatic Aadhaar/document matching. No automatic approval.

### Admin
- Login
- Dashboard
- Review submitted records
- View uploaded photo and Aadhaar document
- Reveal full Aadhaar with audit logging
- Approve or reject with reason
- Approved records receive Volunteer ID
- Generate/print ID card
- QR verification
- Rejected records remain stored; nothing is deleted by the decision action

## Render
Build: `npm install`
Start: `npm start`

Required: DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD, SESSION_SECRET, DATA_ENCRYPTION_KEY.

Do not commit real Aadhaar documents, photos, passwords, or database credentials to GitHub.
