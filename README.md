# QuestRush

QuestRush is a classroom adventure game for the classroom screen. Each student has an emoji pawn on a treasure map, and the class moves through stages of questions. By default the classrooms are kept in the teacher's browser and nobody signs in; with the Google Sheet backend the teacher signs in with Google and the classrooms live in the sheet. The teacher picks students at random, shows a question, and records whether each answer was correct. Students open a public classroom link at home, find their pawn, see their progress and practise the open stages. Practice never changes classroom points.

QuestRush reuses [Quizrush](https://github.com/raghadalsaka/quizrush)'s question files, question card, fonts, design tokens and conventions.

## How it is built

| Part | What it does |
| --- | --- |
| This repository (Vue 3, TypeScript, Vite, Tailwind 4) | Loads and validates the game settings and stage files, picks students and questions at random, reveals answers, draws the map and runs home practice. It is a static site that can be hosted on GitHub Pages. |
| Browser copy (`src/services/browserApi.ts`, `browserStore.ts`), the default | Classrooms, students, sessions and official results kept in this browser's IndexedDB. Every change is saved before it is shown. No sign-in, and the student link works only in this browser. |
| Google Sheet backend (`src/services/googleSheetApi.ts`, `apps-script/`) | Optional: the teacher signs in with Google, the browser reads a Google Sheet once and writes changes back; a read-only Apps Script serves the student link. |
| Rules (`src/services/sheetRules.ts`) | The result rules, shared by both: they answer every screen and refuse what the game doesn't allow. |

The Go API (`../questrush-api`) isn't used by this frontend for now.

### What lives where

| Lives in the frontend (static JSON) | Lives in the browser copy or the sheet's tabs |
| --- | --- |
| `game.json`: title and number of levels | `classrooms`: `slug` (the key, made from the name), name and the class's current stage (`current_stage_slug`) |
| `stages/<slug>.json`: order, lock state, questions and answers | `students`: names and pawns |
| | `turns`: official results and used question ids, by (classroom, stage slug) |
| | `sessions` and `absences`: the open session and who is away |

There is no teacher account: the browser copy belongs to whoever uses this browser, and the sheet's sharing settings decide who can edit it.

**Class progress.** Starting a session on a stage later than the class's current one moves the class there. Reopening an earlier stage for latecomers doesn't move it back. The Stages tab can also set it by hand with **Make Current Stage**. The map flags the class's current stage with 🚩 for the teacher and on the student link.

### Stages are static files

The game is defined by files deployed with the frontend, like Quizrush's `public/contests/`. The files are the same for every classroom.

- **`public/game.json`** holds the general settings, for example `{ "title": "QuestRush", "levels": 6 }`. `levels` is how many levels the map shows (1 to 50).
- **`public/stages/<slug>.json`** holds one stage. It is a Quizrush contest file (`title`, `slug`, `settings`, `questions`) plus:
  - `order`: the level this stage fills, from 1 to `levels`;
  - `unlocked`: `true` or `false`;
  - `description` (optional).

  Each question has an `id`, a `prompt`, 4 `options`, a `correctIndex` and an `explanation`. `src/utils/validateContest.ts` is copied unchanged from Quizrush, and the contest's `settings` are ignored.
- **A level is playable only when its stage file exists and has `"unlocked": true`.** That applies to official sessions and to home practice. Other levels are shown but disabled:
  - a stage file with `"unlocked": false` shows as **Locked**;
  - a level with no stage file yet shows as **Coming soon**.
- **To unlock a stage, set `"unlocked": true` in its file and publish the site.** There is no unlock button in the app. Unlocking applies to every classroom.
- **Validation.** Every file is validated when the site builds (`build/gameCatalog.ts`). These problems fail the build:
  - a file not named `<slug>.json`;
  - two stages with the same `order`;
  - an `order` past `levels`;
  - any invalid question.

  The browser validates a stage file again when it loads it.
- **All stage files are public.** Anyone can download them, answers included, even for locked stages. Locking only controls the interface and official play.
- **The rules don't read stage files.** They check that a stage slug is well formed, not that its file exists or is unlocked; the screens check that. Every result and used question is keyed on (classroom, stage slug).
- **Don't change a stage once it is in use.** Don't rename its slug or remove question ids after official turns begin. The used ids are stored, so used questions still won't repeat, and the session panel warns when used ids are missing from the file.

### Official turn flow

1. From the Stages tab, the teacher starts a session on any open stage. Only one session per classroom is open at a time.
2. Clicking **Pick a Student** makes the browser choose a random eligible student and a random unused question. Eligible means present, and without a result on this stage.
3. The turn lives only in the browser's memory, like a Quizrush card; nothing is saved until it is answered. **Back to Map** or a page refresh ends an unanswered turn without saving anything, and the teacher picks again from the students who still have no result.
4. The question card appears. The teacher taps the option the student chose: the answer is shown and saved at once as **Correct** (one star) or **Incorrect**. The rules check the session, classroom membership, absence, earlier results and question reuse before saving. Results are final, and repeating the same answer never adds a second point.
5. **Different Question** draws another unused question for the same student, like Quizrush's Different Card. Nothing is saved; the set-aside question goes back to the stage for other students.
6. A student who isn't there is marked **Away** on the Students tab. Closing the session stops official play. When the stage is reopened, everyone is present again, results are kept, and students who were away earlier can play.
7. A stage every student has played is **finished**. It can't be opened again or made the current stage; the Stages tab says so, and the rules refuse both. A stage that some students haven't played yet can still be reopened, so they can play, and can still be made current.

Only answered turns are stored (classroom, session, stage, student, question, correct or incorrect), and the rules keep:

- one result per student per stage;
- no repeated question in a stage;
- one open session per classroom.

Total points are always counted from saved correct results, never stored.

## Local development

You need Node 22.12+ (`.nvmrc`). With an empty `.env` the game runs on the browser copy; set the Google Sheet variables to use the sheet instead.

```sh
cp .env.example .env            # VITE_* settings only
npm ci
npm run dev                     # http://localhost:5173
```

### Tests and checks

```sh
npm run check && npx vite build    # type-check, lint, unit tests (including apps-script), build
```

The frontend tests never call Google.

## Samples

| File | What it is |
| --- | --- |
| `public/game.json` | 6 levels. |
| `public/stages/*.json` | Four synthetic stages in the Quizrush format, plus `order` and `unlocked`: Harbour (adding within 20), Jungle (subtraction) and Volcano (times tables), 30 questions each and unlocked; Treasure Cove (shapes, 12 questions) is locked. Levels 5 and 6 have no file and show as Coming soon. |
| `samples/students.xlsx` | A synthetic roster with a header row and 26 valid names. It also has blank rows, extra spaces, two students both named "Sam Lee", a number (`12345`), an empty cell and `???`, to try the import preview. |

## Importing students

1. Upload an `.xlsx` file. The browser reads the first sheet only and saves nothing at this point. The file can be at most 2 MB, and at most 1000 rows and 50 columns are read.
2. Choose the column with the names and say whether the first row is a header.
3. Check the preview:
   - blank cells are skipped and counted;
   - invalid entries (no letters, control characters, longer than 60 characters) are listed and not imported;
   - students with the same name are flagged but kept as separate students, each with its own id.
4. Pawns are assigned automatically and can be edited before saving.

The classroom's slug comes from its name: lowercase a-z and 0-9, with other characters turned into `-` ("Demo: Year 3 Explorers" becomes `demo-year-3-explorers`). A name with no such characters becomes `classroom`, and a slug already in use gets `-2`, `-3` and so on. The slug is the classroom's key and appears in the teacher and student URLs. After saving, the Excel file isn't needed again. The roster and the classroom name are fixed once the classroom is created; students can still be edited, or deleted until they have a result.

## Deployment

### Frontend (GitHub Pages)

`.github/workflows/deploy-pages.yml` type-checks, lints, tests, builds the site and deploys `dist`. Set the repository variable `QUESTRUSH_BASE_PATH`: `/` on a custom domain, or `/<repository>/` on `<user>.github.io/<repository>`. With no backend variables, the site runs on each teacher's browser copy.

Routes use the URL hash (`#/p/<link>`), so every link works on Pages without rewrites.

### Backend option: Google Sheet, no server

Instead of each browser's own copy, the classroom data can live in a Google Sheet. Teachers sign in with a Google account the sheet is shared with; the browser reads the sheet once, answers every screen from that copy and writes changes back in the background, and a read-only Apps Script in `apps-script/` serves the student link. Set the repository variables `QUESTRUSH_GOOGLE_CLIENT_ID`, `QUESTRUSH_SHEET_ID` and `QUESTRUSH_SHEET_API_URL`. Setup and limits are in [`apps-script/README.md`](apps-script/README.md).

## Configuration

The frontend's settings are listed in `.env.example`.

## Known limitations

- **The browser copy stays in one browser.** Without the sheet, classrooms exist only in that browser's site storage: clearing site data or using a private window loses them, and another device can't see them or open the student link. Only one teacher tab per browser can be open at a time.
- **No teacher account.** With the sheet, anyone the sheet is shared with as an editor sees every classroom.
- **No result corrections.** Official results are final by design; there's no edit path.
- **Answers are public.** Stage files are public static files, so a student who knows where to look can see the answers before class, even for locked stages.
- **The rules can't see stage files.** They check that slugs and question ids are well formed and unused, but not that the stage exists, is unlocked, or contains the question. The screens check those.
- **Unlocking is per site, not per classroom.** Every classroom sees the same open stages; unlocking needs a publish.
- **Large maps get crowded.** Past 8 stages the map wraps into two rows, and pawn groups on neighbouring checkpoints can overlap. The student list stays the dependable way to find a student. A group shows up to 11 pawns plus a "+N" bubble.
- **Sharing.** The student link is the classroom's slug (`#/p/year-3-explorers`), so anyone who guesses a class name can open that class's map and names. There's no way to delete a classroom from the interface yet.
- **Testing.** Browser end-to-end tests aren't included. The frontend has unit and component tests.
