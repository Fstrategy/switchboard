#!/usr/bin/env python3
"""Switchboard's fact collector.

Reads three records that already exist on this machine and prints one JSON document for the board:

- ~/.claude/sessions/<pid>.json: which Claude Code sessions are alive, and whether each one is busy,
  idle or waiting for input (Claude Code writes these itself).
- The Claude desktop app's own session records (claude-code-sessions/**/local_*.json): title, which session
  started it, the app's own verdict after each turn on whether a person needs to act and what to do
  (postTurnSummary), the turn's wrap-up line, and session cards still waiting for a click.
- The tail of a busy, waiting or terminal session's transcript: its latest reply and any open question.

It writes nothing anywhere else and calls no model. Whether someone is waiting on the person is the
desktop app's verdict, carried over as is; this script only gathers it.
"""
import argparse
import glob
import json
import os
import re
import subprocess
import sys
import tempfile
import time

HOME = os.path.expanduser("~")
RECENT_MS = 24 * 3600 * 1000      # an idle session that isn't waiting on anyone shows only if touched in the last day
TAIL_BYTES = 400_000              # how much of a transcript's end to read: enough for the latest reply


def temp_prefixes():
    # One-off sessions that scripts start in a temp folder (`claude -p` evals) are not the person's sessions.
    prefixes = {"/private/var/folders/", "/var/folders/", "/private/tmp/", "/tmp/"}
    t = tempfile.gettempdir()
    if t:
        prefixes.add(os.path.join(os.path.realpath(t), ""))
        prefixes.add(os.path.join(t, ""))
    return tuple(prefixes)


TEMP_PREFIXES = temp_prefixes()


def is_temp(cwd):
    return not cwd or cwd.startswith(TEMP_PREFIXES)


def load_json(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return None


def claude_pids(pids):
    """pid -> tty (or None) for the pids that are alive and belong to a Claude process. One call for all."""
    if not pids:
        return {}
    alive = {}
    try:
        if os.name == "nt":
            out = subprocess.run(["tasklist", "/FO", "CSV", "/NH"], capture_output=True, text=True, timeout=10).stdout
            wanted = set(pids)
            for line in out.splitlines():
                cells = [c.strip('"') for c in line.split('","')]
                if len(cells) > 1 and cells[1].isdigit() and int(cells[1]) in wanted and "claude" in cells[0].lower():
                    alive[int(cells[1])] = None
        else:
            out = subprocess.run(
                ["ps", "-o", "pid=,tty=,comm=", "-p", ",".join(str(p) for p in pids)],
                capture_output=True, text=True, timeout=10,
            ).stdout
            for line in out.splitlines():
                parts = line.strip().split(None, 2)
                if len(parts) == 3 and "claude" in parts[2].lower():
                    alive[int(parts[0])] = parts[1] if parts[1] not in ("??", "-") else None
    except Exception:
        return {}
    return alive


def project_dir(cwd):
    # The folder name Claude Code keeps a project's transcripts under: every non-alphanumeric character becomes "-".
    return re.sub(r"[^A-Za-z0-9]", "-", cwd)


def transcript_path(home, cwd, cli_id):
    if not cli_id:
        return None
    guess = os.path.join(home, ".claude", "projects", project_dir(cwd or ""), cli_id + ".jsonl")
    if os.path.exists(guess):
        return guess
    hits = glob.glob(os.path.join(home, ".claude", "projects", "*", cli_id + ".jsonl"))
    return hits[0] if hits else None


def read_tail(path, as_of_iso=None):
    """From the end of a transcript: Claude's latest text reply and a question still unanswered (main thread only)."""
    found = {"reply": None, "question": None}
    try:
        size = os.path.getsize(path)
        with open(path, "rb") as fh:
            fh.seek(max(0, size - TAIL_BYTES))
            chunk = fh.read()
    except Exception:
        return found
    lines = chunk.split(b"\n")
    if size > TAIL_BYTES:
        lines = lines[1:]  # the first line is most likely cut in half
    answered = False  # reading backwards: a tool result seen first means the earlier question was answered
    for raw in reversed(lines):
        if b'"type":"assistant"' not in raw and b'"type": "assistant"' not in raw and b'"tool_result"' not in raw:
            continue
        try:
            rec = json.loads(raw)
        except Exception:
            continue
        if rec.get("isSidechain"):
            continue
        ts = rec.get("timestamp") or ""
        if as_of_iso and ts > as_of_iso:
            continue
        content = (rec.get("message") or {}).get("content")
        if not isinstance(content, list):
            continue
        if rec.get("type") == "user":
            if any(c.get("type") == "tool_result" for c in content):
                answered = True
            continue
        if rec.get("type") != "assistant":
            continue
        for c in content:
            if c.get("type") != "tool_use" or answered or found["question"]:
                continue
            if c.get("name") == "AskUserQuestion":
                qs = (c.get("input") or {}).get("questions") or []
                if qs:
                    found["question"] = {"at": ts, "text": (qs[0].get("question") or "")[:300], "kind": "ask"}
            elif c.get("name") == "ExitPlanMode":
                found["question"] = {"at": ts, "text": "", "kind": "plan"}
        text = "\n".join(c.get("text", "") for c in content if c.get("type") == "text").strip()
        if text and not found["reply"]:
            found["reply"] = {"at": ts, "text": text[:800]}
        if found["reply"]:
            break
    return found


def desktop_bases(home):
    """Where the Claude desktop app keeps its session records on each system (only macOS is tested)."""
    bases = [os.path.join(home, "Library", "Application Support", "Claude", "claude-code-sessions")]
    appdata = os.environ.get("APPDATA")
    if appdata:
        bases.append(os.path.join(appdata, "Claude", "claude-code-sessions"))
    xdg = os.environ.get("XDG_CONFIG_HOME") or os.path.join(home, ".config")
    bases.append(os.path.join(xdg, "Claude", "claude-code-sessions"))
    return [b for b in bases if os.path.isdir(b)]


def desktop_records(home):
    out = {}
    for base in desktop_bases(home):
        for path in glob.glob(os.path.join(base, "*", "*", "local_*.json")):
            d = load_json(path)
            if d is None:
                out[os.path.basename(path)[:-5]] = {"readError": "unreadable"}
            elif "sessionId" in d:
                out[d["sessionId"]] = d
    return out


def summary_of(d):
    p = d.get("postTurnSummary") or {}
    if not p:
        return None
    return {
        "category": p.get("status_category"),
        "detail": (p.get("status_detail") or "").strip(),
        "needs": (p.get("needs_action") or "").strip(),
        # whether the app's verdict is about the latest reply (in a busy session it still describes the turn before)
        "fresh": bool(p.get("summarizes_uuid")) and p.get("summarizes_uuid") == d.get("lastAssistantUuid"),
    }


def open_cards(d):
    resolved = d.get("resolvedBackgroundTaskSuggestions") or {}
    return [c["title"] for c in d.get("backgroundTaskSuggestions") or []
            if c.get("id") and c.get("id") not in resolved and c.get("title")]


def collect(home, now_ms, as_of_iso=None, status_override=None):
    status_override = status_override or {}
    registry = []
    for path in glob.glob(os.path.join(home, ".claude", "sessions", "*.json")):
        r = load_json(path)
        if r and isinstance(r.get("pid"), int) and not is_temp(r.get("cwd", "")):
            registry.append(r)
    alive = claude_pids([r["pid"] for r in registry]) if not status_override else {r["pid"]: None for r in registry}
    live = {}
    for r in registry:
        if r["pid"] not in alive:
            continue
        key = r.get("hostSessionId") or ("cli:" + r.get("sessionId", ""))
        r["_tty"] = alive.get(r["pid"])
        live[key] = r

    desk = desktop_records(home)
    sessions, hidden, errors = [], 0, []
    for key in set(live) | {k for k, d in desk.items() if not d.get("isArchived")}:
        r = live.get(key)
        d = desk.get(key) or {}
        if d.get("readError"):
            sessions.append({"id": key, "kind": "desktop", "title": "", "live": bool(r), "readError": d["readError"]})
            continue
        if d.get("isArchived") and not r:
            continue
        cwd = d.get("cwd") or (r or {}).get("cwd") or ""
        if is_temp(cwd):
            continue
        status = status_override.get(key, r.get("status")) if r else None
        summ = summary_of(d) if d else None
        cards = open_cards(d) if d else []
        waiting = bool(summ and (summ["needs"] or summ["category"] == "blocked")) or bool(cards)
        last_ms = d.get("lastActivityAt") or (r or {}).get("updatedAt") or 0
        if not r and not waiting and now_ms - last_ms > RECENT_MS:
            hidden += 1
            continue
        s = {
            "id": key,
            "kind": "desktop" if key.startswith("local_") else "cli",
            "title": d.get("title") or (r or {}).get("name") or "",
            "cwd": cwd,
            "live": bool(r),
            "status": status,
            "statusAt": (r or {}).get("statusUpdatedAt") or last_ms,
            "createdAt": d.get("createdAt") or (r or {}).get("startedAt") or 0,
            "lastActivityAt": last_ms,
            "lastFocusedAt": d.get("lastFocusedAt") or 0,
            "parent": (d.get("spawnedFrom") or {}).get("sessionId"),
            "summary": summ,
            "wrapUp": ((d.get("turnWrapUp") or {}).get("description") or "").strip()[:500],
            "cards": cards,
            "cliId": (r or {}).get("sessionId") or d.get("cliSessionId"),
            "tty": ("/dev/" + r["_tty"]) if r and r.get("_tty") else None,
            "waitingFor": (r or {}).get("waitingFor") if status == "waiting" else None,
            "progress": None,
            "question": None,
        }
        # A busy session's app verdict still describes the turn before: read its latest reply from the transcript.
        # A session waiting on a question: read what it asks. Terminal sessions have no app record: read them too.
        if s["live"] and (status in ("busy", "waiting") or s["kind"] == "cli"):
            path = transcript_path(home, (r or {}).get("cwd") or cwd, s["cliId"])
            if path:
                tail = read_tail(path, as_of_iso)
                s["progress"] = tail["reply"]
                s["question"] = tail["question"] if status == "waiting" else None
            else:
                errors.append({"kind": "no-transcript", "title": s["title"] or key})
        sessions.append(s)
    sessions.sort(key=lambda s: s.get("createdAt") or 0)
    return {"generatedAt": now_ms, "platform": sys.platform, "sessions": sessions, "hiddenDormant": hidden, "errors": errors}


def prune(directory, older_than_s=3 * 86400, every_s=3600):
    """Delete cached short lines older than three days; at most once an hour."""
    if not directory or not os.path.isdir(directory):
        return
    marker = os.path.join(directory, ".pruned")
    now = time.time()
    try:
        if now - os.path.getmtime(marker) < every_s:
            return
    except OSError:
        pass
    for name in os.listdir(directory):
        p = os.path.join(directory, name)
        try:
            if name != ".pruned" and now - os.path.getmtime(p) > older_than_s:
                os.remove(p)
        except OSError:
            pass
    with open(marker, "w") as fh:
        fh.write(str(int(now)))


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--home", default=HOME)
    ap.add_argument("--out", help="write here (a temp file renamed into place, so readers never see half a file)")
    ap.add_argument("--now-ms", type=int, help="replays: pretend it is this moment")
    ap.add_argument("--as-of", help="replays: read transcripts only up to this moment (ISO, UTC)")
    ap.add_argument("--status-override", help="replays: a JSON file of {session: busy|idle|waiting}")
    ap.add_argument("--prune", help="also delete cache files older than three days in this folder")
    a = ap.parse_args()
    now_ms = a.now_ms or int(time.time() * 1000)
    override = load_json(a.status_override) if a.status_override else None
    facts = collect(a.home, now_ms, a.as_of, override)
    prune(a.prune)
    text = json.dumps(facts, ensure_ascii=False)
    if a.out:
        os.makedirs(os.path.dirname(a.out), exist_ok=True)
        tmp = a.out + ".tmp-%d" % os.getpid()
        with open(tmp, "w", encoding="utf-8") as fh:
            fh.write(text)
        os.replace(tmp, a.out)
    else:
        sys.stdout.write(text)


if __name__ == "__main__":
    main()
