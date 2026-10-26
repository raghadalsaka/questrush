# Google Sheet backend

The classroom data can live in a Google Sheet instead of the Go API and PostgreSQL. It costs nothing and needs no server.

- **The teacher signs in with Google**, using an account the sheet is shared with as an editor. There is no PIN.
- **The browser reads the whole sheet once** at sign-in (two Sheets API requests). Every teacher screen then reads that copy, and the browser checks the game rules itself (`src/services/sheetRules.ts`): one result per student per stage, no repeated question in a stage, one open session per classroom, no reopening a finished stage.
- **Changes show at once** and are written to the sheet in the background, one at a time and in order, through the Sheets API. A failed write is retried; an expired Google sign-in pauses saving until the teacher signs in again; if Google refuses a write, the browser reloads the sheet and says so. The page warns before closing while changes are still saving.
- **The student link** has no sign-in, so it reads one classroom through `Code.js`, a read-only Apps Script web app. It shows names, pawns and results, never used question ids or sessions.

| Sheet tab | Same as the PostgreSQL table |
| --- | --- |
| `classrooms` | `classrooms` |
| `students` | `students` (no photos: pawns are emoji only) |
| `turns` | `turns` |
| `sessions` | `class_sessions` |
| `absences` | `session_absences` |

Every cell is written as plain text, so `=1+1` is never a formula and `007` keeps its zeros. The tabs are created with their header row on the first sign-in.

## Set up

1. **Create a Google Sheet**, for example "QuestRush data". Its id is the part of the URL between `/d/` and `/edit`. Share it as an **Editor** with every teacher's Google account, and with nobody else: anyone who can edit it can change results by hand.
2. **Deploy the student-link script.** In the sheet, open **Extensions > Apps Script**, replace `Code.gs` with `Code.js` (optionally also paste `appsscript.json`), then **Deploy > New deployment > Web app** with *Execute as* **Me** and *Who has access* **Anyone**. Copy the URL that ends in `/exec`.
3. **Create the Google sign-in client** in the [Google Cloud console](https://console.cloud.google.com/):
   1. Create a project, then enable the **Google Sheets API** under **APIs & Services > Library**.
   2. Under **Google Auth Platform**, set up the consent screen as **External**. Under **Audience**, keep it in **Testing** and add each teacher's Google account as a test user. Under **Data access**, add the scope `https://www.googleapis.com/auth/spreadsheets`.
   3. Under **Clients**, create an **OAuth client ID** of type **Web application**. Add the site's origin under **Authorized JavaScript origins**, for example `https://<user>.github.io`, plus `http://localhost:5173` for local development. No redirect URI is needed. Copy the client id.
4. **In the GitHub repository**, set the variables `QUESTRUSH_GOOGLE_CLIENT_ID`, `QUESTRUSH_SHEET_ID` and `QUESTRUSH_SHEET_API_URL`, leave `QUESTRUSH_API_BASE_URL` empty, and run the "Deploy frontend to GitHub Pages" workflow. None of these values is secret; the sheet's sharing settings protect the data.

For local development, put the same three values in `VITE_GOOGLE_CLIENT_ID`, `VITE_SHEET_ID` and `VITE_SHEET_API_URL` in `.env` and run `npm run dev`.

## Afterwards

- **Updating the script:** paste the new `Code.js`, then **Deploy > Manage deployments > Edit > Version: New version**. The `/exec` URL stays the same.
- **Adding a teacher:** share the sheet with their Google account as an editor and add them as a test user on the consent screen.
- **Backups:** **File > Make a copy**, or download the sheet. QuestRush never deletes a classroom or a result.
- **Don't rename tabs or edit their first row.** QuestRush refuses to read a tab whose header row changed, instead of misreading it.

## Limits

- While the app is in **Testing**, Google shows an "unverified app" screen at the first sign-in (choose *Continue*) and asks the teacher to approve access again about once a week. Publishing the app removes this but needs Google's verification for the Sheets scope.
- A Google sign-in lasts about an hour. After that, the next save shows **Sign In Again**; nothing typed or recorded in the meantime is lost while the tab stays open.
- The browser checks the rules against the copy it loaded. With the same classroom open on two devices at once, results can conflict until one of them reloads. Before changing or removing an existing row, the browser re-reads it and stops if the sheet changed.
- Signing in grants the site access to the teacher's Google Sheets for that tab only; the token is kept in memory and revoked on sign-out.
- Editing the sheet by hand bypasses every rule.
