# Porting Switchboard to another agent harness

Switchboard is written for Claude Code, but most of it doesn't care which harness it runs in. This page says what carries over as is, what has to be rewritten for the new host, and how to tell the port is done.

## Carries over as is

| File | What it does |
|---|---|
| `hooks/logic.ts` | Arranges the facts into a board: what waits on the person and in which order, what was left for a while, coordinators grouped with the sessions they started, what is working, what is done. Also: when to ask the model again, the cache fingerprint. Pure functions, no host calls. |
| `hooks/i18n.ts` | Every word on the board, and the prompt that turns one session into short lines, in English and Chinese. |
| `hooks/demo.ts` | The made-up sessions behind `/switchboard demo`. |
| `types/index.d.ts` | The two contracts below (drop the `declare module 'claude-code'` block at the end). |

## Rewrite for the new host

1. **Facts** (`hooks/collect.py` here). Produce the `Facts` shape in `types/index.d.ts` from the new harness's own records. Per session:
   - `live`: is its process running;
   - `status`: `busy` (working), `idle`, or `waiting` (stopped on a question to the person or a permission prompt);
   - `question`: the open question's text, if any;
   - `progress`: its latest reply;
   - `parent`: the session that started it, if the harness records that (this is what groups a coordinator with its lines);
   - `summary`: only if the harness itself judges after a turn whether a person needs to act. Most don't. Leave it out and the board falls back to the model's reading of the last reply (`needs_user`), the way it handles Claude Code's terminal sessions.
2. **Host calls** (`hooks/register.tsx` here). Map each Claude Code call to the new harness's plugin API:
   - a pane beside the chat (`$.ui.open` + `ui.render` on `Pane`);
   - a one-line band above the prompt (`ui.render` on `AbovePrompt`);
   - a model call with a small, cheap model (`$.model.complete`);
   - file reads and writes, a timer, a slash command;
   - running a program, if the facts come from a separate script.

   No side panel in the new host? Put the board behind the slash command and keep the one-line band (or a status line) as the always-visible part.
3. **Jumping to a session** (`jumpArgv` in `hooks/logic.ts`). Use whatever brings a session to the front in the new host: a deep link, a terminal tab, a resume command.

## The contracts

- **Facts → board**: `Facts` and `SessionFact` in `types/index.d.ts`. Everything the board shows comes from these fields; nothing is inferred elsewhere.
- **Model → short lines**: the JSON format at the end of `PROMPTS[lang].format` in `hooks/i18n.ts`: `short`, `project`, `doing`, `ask`, `why`, `needs_user`, `for_user`, `blocking`, `relay`, `closeable`. `parseText` in `hooks/logic.ts` reads it and caps every field's length.

## Done means

Port the scenarios in `hooks/switchboard.test.tsx` to the new host's test setup. They are the acceptance criteria:

1. With the demo sessions: the coordinator holding up its lines comes first, then the session asking a question, then the unclicked card; the session that stopped two days ago sits in its own group below.
2. Once the person replies and the session goes back to work, it leaves "Waiting on you".
3. The band above the prompt counts only the other sessions, never the one it is drawn in.
4. With nothing waiting, the band still shows, with a button that opens the board.
5. When collecting fails, the board says it didn't refresh and why, instead of showing stale or guessed data.
6. One-off sessions that scripts start in a temp folder get no board.
7. The language follows the system locale; the setting overrides it; the prompt goes out in the same language.
8. With short lines off, no model is called and the records' own words are shown.
9. A session whose last reply asks the person something counts as waiting, even without a verdict from the harness.
10. A session that only relays ("go to that session and…") is not listed a second time.
11. `/switchboard demo` swaps in the made-up sessions, a jump there opens nothing, and running it again goes back.
