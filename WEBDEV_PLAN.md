# Web Studio Plan

Build and refine small websites by chatting, with the code saved between turns and a live preview beside the chat. Everything runs on your own machine, with local models and no new services, so it keeps working without frontier models or hosted AI.

## Status

Phases 1 to 3 are finished, so the studio is usable. Phase 4, polish, is next.

- **Phase 1, foundation:** `/web <description>` starts a project in a chat, and every later message in that chat works on it. The model builds with the file tools, each turn that changes files saves a version, and labels under the reply say what changed. The backend is in `backend/project_mode.py` and `backend/actions/project_files.py`.
- **Phase 2, real preview:** the studio shows the stored project: its files, a preview that follows each new version, older versions to look at, and the chat, which is the same conversation as the main chat. One project card sits on the latest project reply with a live thumbnail. Tapping a change label opens that file. The code is read-only for now. The frontend is in `frontend/src/webdev/`.
- **Phase 3, reliability:**
  - **Fix it:** the preview reports its errors (uncaught errors, failed promises, `console.error` and files that fail to load) to the studio, which shows the first one over the site with a Fix it button. Fix it sends the errors to the model as a message. Errors name the file and line, and clear when the preview reloads.
  - **Tolerant edits:** when `edit_file`'s text doesn't match exactly, it tries again ignoring spacing, and takes it if that matches once. When nothing matches, a file under 8,000 characters comes back with the error, so the model can retry or rewrite it without another call.
  - **Restore:** an older version has a Restore button. Restoring saves it as a new version, so nothing is lost, and the next turn tells the model the files were restored.
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
- **Versions:** every turn saves one, and an older version can be restored with one tap.
- **Fix it:** when the preview hits an error, a button sends the error to the model.
- **Phones:** the site is full screen with the input bar at the bottom. The chat slides up as a sheet, and the code drawer covers the screen.
- **Export:** download the project as a zip. Share links come later.

## Architecture

### Storage (the existing Postgres)

- **projects:** id, chat id, name, current version.
- **project_files:** project id, path, contents.
- **project_versions:** project id, version number, a snapshot of all files, and the message that made it. Small sites are a few kilobytes, so full snapshots are fine and keep undo simple.

### Model tools (in the existing tool loop, `backend/actions`)

- `list_files`: names and sizes.
- `read_file`: one file's contents.
- `write_file`: create a file, or replace it whole.
- `edit_file`: replace a snippet with a new one. It tolerates small differences such as spacing, since local models rarely copy text exactly. For small files, a full rewrite is the fallback when an edit doesn't match.
- `delete_file`.

### What each request includes

- The file list, plus `index.html`, any file the user named, and recently changed files. The model reads anything else with `read_file`. This keeps requests within local models' context windows.
- **Prompt rules:**
  - Edit, don't regenerate.
  - Keep the file structure.
  - Use the libraries ModelLoop serves.
  - Never paste whole files into the chat reply.
- **Tool rounds:** project mode raises the limit from 5 rounds to about 10 to 15, since a build takes several steps.

### Model choice

- Project mode prefers an installed coding model (for example, the Qwen coder models), and says so when none is installed.
- It needs a model that can call tools. Without one, project mode is unavailable, with a short explanation.

### Preview

- **How it's built:** the project's files go into one document in the browser, with stylesheets and scripts put inline. It loads in a sandboxed frame (`sandbox="allow-scripts allow-forms"`, without `allow-same-origin`), so generated code can't read the user's login or chats. `buildPreview()` in `frontend/src/webdev/preview.ts` does this.
- **Errors:** a small script inside the frame sends errors and console output to the app. That feeds the Fix it button.
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
4. **Polish:**
   - The served library set.
   - Zip download.
   - Starter templates (Blank, Landing page, Store, Game).
5. **Later:**
   - Editable code (CodeMirror 6, which works well on phones). Manual edits save as a version.
   - Multi-file React and TypeScript, bundled in the browser with esbuild.
   - Share links served from a separate domain.

Phases 1 to 3 make it usable. Phase 4 makes it feel finished.

## Risks

| Risk | Plan |
|---|---|
| Small models fumble edits | Tolerant matching, a full-rewrite fallback, and undo |
| Projects outgrow the model's context | Send the file list and only the files that matter; the model reads the rest |
| The model breaks working code | A version every turn, one-tap restore, and Fix it |
| Generated code misbehaves | A sandboxed preview with no access to the app |
| No internet | Libraries served by ModelLoop; local models only |
| Phone screens | The site full screen, the chat as a sheet, no editor needed |

## Decisions

1. **One project per chat.** The chat is the project's conversation. A chat becomes a project chat on its first `/web` turn and stays one.
2. **Errors reach the model only through Fix it.** Nothing is sent automatically.
3. **React is in the first version, served by ModelLoop.** It arrives with the served library set in Phase 4. Until then the prompt asks for plain HTML, CSS and JavaScript, with jsDelivr for libraries.
