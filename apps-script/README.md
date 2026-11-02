# Google Sheet backend

The classroom data can live in a Google Sheet instead of in each browser's own copy. It costs nothing and needs no server.

- **The teacher signs in with Google**, using an account the sheet is shared with as an editor. There is no PIN.
- **The browser keeps a copy of the sheet** in its own storage (IndexedDB), together with the changes the sheet hasn't taken yet. Every teacher screen reads that copy, and the browser checks the game rules itself (`src/services/sheetRules.ts`): one result per student per stage, no repeated question in a stage, one open session per classroom, no reopening a finished stage.
- **Changes show at once**, are kept in the browser straight away and are sent to the sheet in the background, one at a time and in order. A failed write is retried; while offline or after the Google sign-in expires, changes wait in the browser, also across a refresh or a sign-out, and are sent after the next sign-in. If Google refuses a write (for example, the account lost edit access), the waiting changes are dropped and the browser reloads the sheet.
- **The browser and the sheet sync** at sign-in, every minute, and when the tab comes back into view or the connection returns. Each sync reads the whole sheet and replays the browser's unsent changes on top of it. **The sheet wins:** a change goes through only while its row on the sheet is still the way the browser last saw it. A change the sheet already contradicts (the same row edited elsewhere, a result already recorded for that student and stage, another session already open) is dropped along with what depended on it, and the banner says how many changes were dropped. A classroom created offline whose name was taken on the sheet meanwhile is saved under a free link (`-2`, `-3`) instead.
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
4. **In the GitHub repository**, set the variables `QUESTRUSH_GOOGLE_CLIENT_ID`, `QUESTRUSH_SHEET_ID` and `QUESTRUSH_SHEET_API_URL`, and run the "Deploy frontend to GitHub Pages" workflow. None of these values is secret; the sheet's sharing settings protect the data.

For local development, put the same three values in `VITE_GOOGLE_CLIENT_ID`, `VITE_SHEET_ID` and `VITE_SHEET_API_URL` in `.env` and run `npm run dev`.

## Afterwards

- **Updating the script:** paste the new `Code.js`, then **Deploy > Manage deployments > Edit > Version: New version**. The `/exec` URL stays the same.
- **Adding a teacher:** share the sheet with their Google account as an editor and add them as a test user on the consent screen.
- **Backups:** **File > Make a copy**, or download the sheet. QuestRush never deletes a classroom or a result.
- **Don't rename tabs or edit their first row.** QuestRush refuses to read a tab whose header row changed, instead of misreading it.

## Limits

- While the app is in **Testing**, Google shows an "unverified app" screen at the first sign-in (choose *Continue*) and asks the teacher to approve access again about once a week. Publishing the app removes this but needs Google's verification for the Sheets scope.
- A Google sign-in lasts about an hour, and a refresh needs a new sign-in because the Google token is never stored. Either way nothing is lost: the next save shows **Sign In Again**, and changes made meanwhile are kept in the browser.
- Two devices teaching at once can still disagree for up to a minute; the next sync settles it, and the sheet wins. Only one tab per browser can teach at a time.
- Signing out sends what it can first. The browser's copy is cleared only when nothing is left unsent; otherwise it stays for the next sign-in in that browser.
- Signing in grants the site access to the teacher's Google Sheets for that tab only; the token is kept in memory and revoked on sign-out.
- Editing the sheet by hand bypasses every rule.
