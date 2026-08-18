# Juloos Volunteer System — Google Sheets Edition
No PostgreSQL. Registration data is stored in Google Sheets; uploaded files are stored in your private Google Drive folder via Google Apps Script.

Setup: open google-apps-script/Code.gs, create a Google Sheet, Extensions > Apps Script, paste Code.gs, change SECRET, Deploy > New deployment > Web app > Execute as Me > Who has access Anyone. Put the web app URL in Render as GOOGLE_SCRIPT_URL and the same SECRET as GOOGLE_SCRIPT_SECRET.

Render variables: ADMIN_EMAIL, ADMIN_PASSWORD, SESSION_SECRET, GOOGLE_SCRIPT_URL, GOOGLE_SCRIPT_SECRET.
