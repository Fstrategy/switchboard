"""Tests for hooks/collect.py against a made-up home folder. Run: python3 -m unittest discover tests"""
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "hooks", "collect.py")
sys.path.insert(0, os.path.join(HERE, "..", "hooks"))
import collect  # noqa: E402

NOW = 1_800_000_000_000
MIN = 60_000
DAY = 24 * 60 * MIN


def write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(data if isinstance(data, str) else json.dumps(data))


def jsonl(*records):
    return "\n".join(json.dumps(r) for r in records) + "\n"


class CollectTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = os.path.join(self.tmp.name, "home")
        # never read the real desktop records of whoever runs the tests
        self.env = {k: os.environ.get(k) for k in ("APPDATA", "XDG_CONFIG_HOME")}
        os.environ.pop("APPDATA", None)
        os.environ["XDG_CONFIG_HOME"] = os.path.join(self.home, ".config")
        desk = os.path.join(self.home, "Library", "Application Support", "Claude", "claude-code-sessions", "acct", "org")
        sessions = os.path.join(self.home, ".claude", "sessions")

        # a desktop session, open, stopped on a question it asked
        write(os.path.join(sessions, "111.json"), {
            "pid": 111, "sessionId": "cli-1", "cwd": "/work/shop", "status": "waiting",
            "waitingFor": "input needed", "hostSessionId": "local_ask", "statusUpdatedAt": NOW - 5 * MIN,
        })
        write(os.path.join(desk, "local_ask.json"), {
            "sessionId": "local_ask", "title": "Landing page", "cwd": "/work/shop", "cliSessionId": "cli-1",
            "createdAt": NOW - 60 * MIN, "lastActivityAt": NOW - 5 * MIN,
        })
        write(os.path.join(self.home, ".claude", "projects", "-work-shop", "cli-1.jsonl"), jsonl(
            {"type": "assistant", "timestamp": "2027-01-15T08:00:00Z",
             "message": {"content": [{"type": "text", "text": "Two headline options are ready."}]}},
            {"type": "assistant", "timestamp": "2027-01-15T08:01:00Z",
             "message": {"content": [{"type": "tool_use", "name": "AskUserQuestion",
                                      "input": {"questions": [{"question": "Which headline?"}]}}]}},
        ))

        # a terminal session, idle, its last reply asking something in plain text
        write(os.path.join(sessions, "222.json"), {
            "pid": 222, "sessionId": "cli-2", "cwd": "/work/api", "status": "idle", "statusUpdatedAt": NOW - 3 * MIN,
            "startedAt": NOW - 30 * MIN, "name": "Refactor auth",
        })
        write(os.path.join(self.home, ".claude", "projects", "-work-api", "cli-2.jsonl"), jsonl(
            {"type": "assistant", "timestamp": "2027-01-15T08:02:00Z",
             "message": {"content": [{"type": "text", "text": "First pass done. Rename the old tables too?"}]}},
            {"type": "assistant", "isSidechain": True, "timestamp": "2027-01-15T08:03:00Z",
             "message": {"content": [{"type": "text", "text": "a subagent's words, not the session's"}]}},
        ))

        # a script's one-off session in a temp folder: not the person's
        write(os.path.join(sessions, "333.json"), {"pid": 333, "sessionId": "cli-3", "cwd": "/tmp/eval-7", "status": "busy"})

        # closed sessions: one long done (hidden), one still waiting on him (kept), one archived, one unreadable
        write(os.path.join(desk, "local_old.json"), {
            "sessionId": "local_old", "title": "Old chore", "cwd": "/work/shop", "lastActivityAt": NOW - 3 * DAY,
            "postTurnSummary": {"status_category": "completed", "status_detail": "done", "needs_action": ""},
        })
        write(os.path.join(desk, "local_stale.json"), {
            "sessionId": "local_stale", "title": "Search ranking", "cwd": "/work/shop", "lastActivityAt": NOW - 2 * DAY,
            "spawnedFrom": {"sessionId": "local_ask"},
            "postTurnSummary": {"status_category": "blocked", "status_detail": "measured both",
                                "needs_action": "decide on fuzzy matching", "summarizes_uuid": "u1"},
            "lastAssistantUuid": "u1",
            "backgroundTaskSuggestions": [{"id": "c1", "title": "Tune typo ranking"}, {"id": "c2", "title": "Done one"}],
            "resolvedBackgroundTaskSuggestions": {"c2": True},
        })
        write(os.path.join(desk, "local_gone.json"), {
            "sessionId": "local_gone", "title": "Archived", "cwd": "/work/shop", "isArchived": True, "lastActivityAt": NOW,
        })
        write(os.path.join(desk, "local_bad.json"), "{ not json")

        write(os.path.join(self.tmp.name, "status.json"), {"local_ask": "waiting", "cli:cli-2": "idle"})
        self.status = os.path.join(self.tmp.name, "status.json")

    def tearDown(self):
        for k, v in self.env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        self.tmp.cleanup()

    def collect(self):
        with open(self.status) as fh:
            return collect.collect(self.home, NOW, None, json.load(fh))

    def by_id(self, facts):
        return {s["id"]: s for s in facts["sessions"]}

    def test_the_open_question_is_read_from_the_transcript(self):
        s = self.by_id(self.collect())["local_ask"]
        self.assertTrue(s["live"])
        self.assertEqual(s["status"], "waiting")
        self.assertEqual(s["question"]["text"], "Which headline?")
        self.assertEqual(s["title"], "Landing page")

    def test_a_terminal_session_carries_its_last_reply_and_skips_subagents(self):
        s = self.by_id(self.collect())["cli:cli-2"]
        self.assertEqual(s["kind"], "cli")
        self.assertEqual(s["title"], "Refactor auth")
        self.assertEqual(s["progress"]["text"], "First pass done. Rename the old tables too?")
        self.assertIsNone(s["question"])

    def test_what_is_left_out_and_what_stays(self):
        facts = self.collect()
        ids = set(self.by_id(facts))
        self.assertNotIn("cli:cli-3", ids)       # temp folder
        self.assertNotIn("local_gone", ids)      # archived
        self.assertNotIn("local_old", ids)       # closed, done, untouched for days: only counted
        self.assertEqual(facts["hiddenDormant"], 1)
        self.assertIn("local_stale", ids)        # closed but still waiting on him: kept
        self.assertEqual(self.by_id(facts)["local_bad"]["readError"], "unreadable")

    def test_the_desktop_verdict_cards_and_parent_carry_over(self):
        s = self.by_id(self.collect())["local_stale"]
        self.assertFalse(s["live"])
        self.assertEqual(s["summary"], {"category": "blocked", "detail": "measured both",
                                        "needs": "decide on fuzzy matching", "fresh": True})
        self.assertEqual(s["cards"], ["Tune typo ranking"])
        self.assertEqual(s["parent"], "local_ask")

    def test_the_command_line_writes_the_whole_file_at_once(self):
        out = os.path.join(self.tmp.name, "board", "facts.json")
        subprocess.run([sys.executable, SCRIPT, "--home", self.home, "--out", out, "--now-ms", str(NOW),
                        "--status-override", self.status], check=True, env=os.environ.copy())
        with open(out, encoding="utf-8") as fh:
            facts = json.load(fh)
        self.assertEqual(facts["generatedAt"], NOW)
        self.assertEqual(len(facts["sessions"]), 4)
        self.assertEqual([n for n in os.listdir(os.path.dirname(out)) if ".tmp-" in n], [])

    def test_prune_removes_only_old_cache_files(self):
        cache = os.path.join(self.tmp.name, "text")
        write(os.path.join(cache, "old.json"), "{}")
        write(os.path.join(cache, "new.json"), "{}")
        week_ago = time.time() - 7 * 86400
        os.utime(os.path.join(cache, "old.json"), (week_ago, week_ago))
        collect.prune(cache)
        self.assertEqual(sorted(n for n in os.listdir(cache) if n != ".pruned"), ["new.json"])


if __name__ == "__main__":
    unittest.main()
