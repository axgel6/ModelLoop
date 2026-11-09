# Web Studio Plan

Build and refine small websites by chatting, with the code saved between turns and a live preview beside the chat. Everything runs on your own machine, with local models and no new services, so it keeps working without frontier models or hosted AI.

## Status

Phases 1 to 3 are finished, so the studio is usable. In Phase 4, the agent pipeline, the planner and the checker are built. Per-file writers, the locator and editor, and the reviewer are next.

- **Phase 1, foundation:** `/web <description>` starts a project in a chat, and every later message in that chat works on it. The model builds with the file tools, each turn that changes files saves a version, and labels under the reply say what changed. The backend is in `backend/project_mode.py` and `backend/actions/project_files.py`.
- **Phase 2, real preview:** the studio shows the stored project: its files, a preview that follows each new version, older versions to look at, and the chat, which is the same conversation as the main chat. One project card sits on the latest project reply with a live thumbnail. Tapping a change label opens that file. The code is read-only for now. The frontend is in `frontend/src/webdev/`.
- **Phase 3, reliability:**
  - **Fix it:** the preview reports its errors (uncaught errors, failed promises, `console.error` and files that fail to load) to the studio, which shows the first one over the site with a Fix it button. Fix it sends the errors to the model as a message. Errors name the file and line, and clear when the preview reloads.
  - **Tolerant edits:** when `edit_file`'s text doesn't match exactly, it tries again ignoring spacing, and takes it if that matches once. When nothing matches, a file under 8,000 characters comes back with the error, so the model can retry or rewrite it without another call.
  - **Restore:** an older version has a Restore button. Restoring saves it as a new version, so nothing is lost, and the next turn tells the model the files were restored.
- **Phase 4, so far:**
  - **Planner:** a new project's first build starts with a spec (features, files, shared names, fixed values), written by the same model without tools. It is stored on the project and sent with every later turn. If the planner fails or times out, the build goes ahead without a spec. Every new build is planned; questions and later turns are not. The code is `write_spec` in `backend/project_mode.py`.
  - **Checker and fixer:** when the model finishes a turn that changed files, `backend/project_checks.py` checks them. The chat also runs the files in a hidden preview (`frontend/src/webdev/check.ts`) and reports runtime errors back. Problems go back to the model to fix, up to 3 times, and the reply says what was fixed or what is still wrong. The progress list shows "Planned the site", "Found 2 problems to fix" and "Checked the site".
  - **Tested so far:** on `qwen2.5-coder:7b`, a spec takes about 15 to 20 seconds, and four real builds (snake, a bakery page, a todo list, a timer) passed the checks with no false alarms. A full studio turn, with the hidden preview reporting back and fix rounds running, has not been run end to end yet.
- The `/testweb` design demo is gone, now that real projects cover it.

## Scope

**First version:** single-page sites, small apps and games in HTML, CSS and JavaScript, plus common libraries (React included) served by ModelLoop itself.

**Not yet:** npm installs, backends, databases, deploying.

## User experience

The site is the focus, and the chat floats beside it.

- **In the chat:** a project appears as one card, with a live thumbnail of the site and what changed. Each turn updates that card instead of adding a new one. Tapping it opens the studio.
- **The studio:**
  - The preview fills the screen. A size toggle switches between desktop, tablet and phone.
  - The chat is a floating glass panel on the right. Hiding it leaves the input bar floating over the bottom of the site.
  - Code is a drawer on the left, with file tabs. It is hidden by default, since the model writes the code.
  - The top bar has back, the project name, the version picker, reload, Code and Chat.
- **After each reply:** labels like "Edited style.css" show what changed. Tapping one opens that file.
- **While building:** the reply lists each finished step ("Planned the site", "Created index.html", "Found 2 problems to fix", "Checked the site") with a timer on the current one, so a long build doesn't look stuck.
- **Versions:** every turn saves one, and an older version can be restored with one tap.
- **Fix it:** when the preview hits an error, a button sends the error to the model.
- **Phones:** the site is full screen with the input bar at the bottom. The chat slides up as a sheet, and the code drawer covers the screen.
- **Export:** download the project as a zip. Share links come later.

## Architecture

### Storage (the existing Postgres)

- **projects:** id, chat id, name, current version, and the current spec (see the agent pipeline).
- **project_files:** project id, path, contents.
- **project_versions:** project id, version number, a snapshot of all files, and the message that made it. Small sites are a few kilobytes, so full snapshots are fine and keep undo simple.
- **project_checks:** a runtime check a running turn is waiting on: chat id, and the errors once the browser answers. A row is deleted once read, and rows over an hour old are cleared. A row is used instead of memory so the answer reaches the turn whichever server process takes it.

### Model tools (in the existing tool loop, `backend/actions`)

- `list_files`: names and sizes.
- `read_file`: one file's contents.
- `write_file`: create a file, or replace it whole.
- `edit_file`: replace a snippet with a new one. It tolerates small differences such as spacing, since local models rarely copy text exactly. For small files, a full rewrite is the fallback when an edit doesn't match.
- `delete_file`.

### Agent pipeline

Instead of one model call doing everything, each turn runs as a chain of narrow steps. Small local models do much better on a focused task with little context, and speed matters less than the result. All steps use the same model; only the prompt and the context change.

Built so far: the planner, and the checker with the fixer. Until the file writers exist, one call builds every file from the spec.

The risk with splitting the work is that steps drift apart, for example CSS styling `.game-board` while the HTML uses `#board`. Every step therefore follows one shared **spec**, and each later step sees the real files written before it, not a guess at them.

**New project ("Develop a snake game"):**

1. **Planner** (built) writes the spec:
   - what the site does, as a short feature checklist ("arrow keys move", "score shows", "game over restarts");
   - the file list, and what each file is responsible for;
   - the shared names: element IDs, class names, functions, and which file defines each;
   - how the files connect (which scripts load, in what order, canvas size and similar fixed values).
2. **File writers** (not yet), one per file, in order: HTML first, then CSS, then JavaScript. Each one gets the spec plus every file already written, and writes only its own file. They run one after another, not in parallel, so each builds on real code.
3. **Checker** (built) looks for errors from real signals, not by reading the code and guessing:
   - **Static checks (backend):**
     - every stylesheet and script `index.html` loads exists;
     - CSS and JavaScript have no unclosed brackets, strings, templates or comments (the JavaScript reader tells regular expressions from division, and skips projects compiled in the browser with Babel);
     - every id and class the JavaScript looks up exists somewhere in the HTML or JavaScript;
     - a stylesheet isn't styling mostly names the page doesn't have, the sign it was written for different HTML. A few unused rules are normal and not reported.
   - **Runtime errors (browser):** the chat loads the new files in a hidden, sandboxed preview for a few seconds, using the Fix it error reporting, and posts what it saw. This works whenever the chat is open, not only in the studio. The turn waits up to 10 seconds, then goes on with the static checks alone. `console.error` and files from other sites that fail to load are ignored.
4. **Fixer** (built) gets the exact problems and repairs them with the file tools, with 6 tool rounds per fix. The checker runs again only when a fix changed something, up to 3 checks in all. Anything still broken is listed in the reply, with Fix it available as usual.
5. **Reviewer** (not yet) compares the result with the spec's feature checklist and reports anything missing. Missing features go back to the fixer once; after that they are listed in the reply.

**Changes ("make the snake faster", "add a pause button"),** not built yet, except that the checker and fixer already run after every change:

1. **Locator** reads the spec and the files, and returns a list of places to change: file, line range, and what should change there. One request often touches several files (a pause button needs HTML, CSS and JavaScript), so it returns a list, not a single spot.
2. **Editor** handles one place at a time. It sees only those lines, a little surrounding context and the instruction, and makes the change with `edit_file`.
3. **Check:** each edit must apply cleanly (the old text matched, the file still parses). Then the checker and fixer run as for a new project.
4. **Spec update:** if the change adds a feature or a shared name, the planner updates the spec so later turns stay consistent.

**Sizing** (not yet; for now every new build is planned and every change is one call): the planner also judges the request's size. A one-file request ("make a counter") or a one-line change ("make the title red") skips the pipeline and runs as a single call, since extra steps would only add places to lose detail.

### What each request includes

- **Single call:** the file list, plus `index.html`, any file the user named, and recently changed files. The model reads anything else with `read_file`. This keeps requests within local models' context windows.
- **Pipeline steps:** the spec, plus only what that step needs (the files written so far for a writer, a few lines for the editor, the error list for the fixer).
- **Prompt rules:**
  - Edit, don't regenerate.
  - Keep the file structure.
  - Follow the spec's names exactly.
  - Use the libraries ModelLoop serves.
  - Never paste whole files into the chat reply.
- **Tool rounds:** a single call allows about 10 to 15 rounds. Each pipeline step gets its own smaller limit, since each does one thing.

### Model choice

- Project mode prefers an installed coding model (for example, the Qwen coder models), and says so when none is installed.
- It needs a model that can call tools. Without one, project mode is unavailable, with a short explanation.

### Preview

- **How it's built:** the project's files go into one document in the browser, with stylesheets and scripts put inline. It loads in a sandboxed frame (`sandbox="allow-scripts allow-forms"`, without `allow-same-origin`), so generated code can't read the user's login or chats. `buildPreview()` in `frontend/src/webdev/preview.ts` does this.
- **Errors:** a small script inside the frame sends errors and console output to the app. That feeds the Fix it button and the pipeline's checker.
- **Refresh:** the preview reloads after each change.

### Libraries, offline

- **Served by the backend:** a curated set (React, Tailwind, Three.js, a chart library and a game library), so previews work offline and load fast.
- **Fallback:** when online, the model may use a public CDN (jsDelivr, unpkg, cdnjs) for anything else. They're free, with no account.

## Build order

1. **Foundation:**
   - Project, file and version tables, plus a startup migration.
   - The file tools.
   - Project mode in a chat.
   - Change labels under replies.
2. **Real preview:** the studio driven by the stored project instead of the sample, plus the project card with its live thumbnail.
3. **Reliability:**
   - Error reporting and Fix it.
   - Tolerant edits.
   - Version history with restore.
4. **Agent pipeline**, in order of value:
   - Done: the planner and its stored spec.
   - Done: the checker (static checks and runtime errors from a hidden preview) and the fixer loop.
   - Done: step progress for the plan and the checks.
   - Next: file writers, one per file, in order, with sizing.
   - The locator and editor for changes, and spec updates.
   - The reviewer.
5. **Polish:**
   - The served library set.
   - Zip download.
   - Starter templates (Blank, Landing page, Store, Game).
6. **Later:**
   - Editable code (CodeMirror 6, which works well on phones). Manual edits save as a version.
   - Multi-file React and TypeScript, bundled in the browser with esbuild.
   - Share links served from a separate domain.

Phases 1 to 3 make it usable. Phase 4 makes the results better. Phase 5 makes it feel finished.

## Risks

| Risk | Plan |
|---|---|
| Small models fumble edits | The editor sees only a few lines, tolerant matching, a full-rewrite fallback, and undo |
| Projects outgrow the model's context | Each step gets the spec and only the files it needs; the model reads the rest |
| Pipeline steps drift apart | One shared spec with exact names, files written in order, and a static name check |
| Details get lost between steps | The spec travels with every step; small requests skip the pipeline |
| Fix loops go in circles | At most 3 check-and-fix rounds, a new check only after a fix changed something, then the reply lists what's left |
| The checker reports a problem that isn't one | Report only what is surely wrong: a name counts as defined if it appears anywhere else, ids built at runtime turn the id check off, and a few unused CSS rules are allowed |
| Builds get slower | Planning takes about 20 seconds and each check up to 10; the step list and timer show it's working |
| Small context windows (4,096 tokens on some setups) | The spec is capped at 3,000 characters; per-step context comes with the file writers and the editor |
| The model breaks working code | A version every turn, one-tap restore, and Fix it |
| Generated code misbehaves | A sandboxed preview with no access to the app |
| No internet | Libraries served by ModelLoop; local models only |
| Phone screens | The site full screen, the chat as a sheet, no editor needed |

## Decisions

1. **One project per chat.** The chat is the project's conversation. A chat becomes a project chat on its first `/web` turn and stays one.
2. **Errors reach the model automatically only inside a turn.** While a turn runs, the pipeline's checker feeds errors to the fixer. Errors found after the turn ends reach the model only through Fix it.
3. **React is in the first version, served by ModelLoop.** It arrives with the served library set in Phase 5. Until then the prompt asks for plain HTML, CSS and JavaScript, with jsDelivr for libraries.
4. **One model for every step.** The pipeline changes prompts and context, not models, so it works with a single installed coding model.
5. **The spec is written once, when the project starts.** Later turns read it but don't change it, and the user's newest request wins where they differ. Updating it comes with the locator and editor.
