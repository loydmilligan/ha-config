#!/usr/bin/env python3
"""Billy's FluentPet press log: one JSON object per line in /config/fluentpet/presses.jsonl.

Called by Home Assistant through shell_command.fluentpet (packages/fluentpet.yaml):
    fluentpet.py <command> [arg] [arg2]
JSON arguments arrive base64-encoded so no quoting can break them. Standard library only.

Commands
  log <b64 press>            append a press line; prints {"id", "token", "duplicate"}
  drink <b64 {ts,event_type}> append a "drink_button" line (the long smart button by the water)
  context <id> <b64 dict>    merge a context result into that press's line
  clip <id>                  after camera.record: wait for the file, grab a snapshot, record both
  notify <id>                send the ntfy notification for that press
  label <id> <label> [token] write the label onto that press's line (token required if given)
  label_latest <label>       label the newest unlabelled, scored press (HA dashboard buttons)
  backfill <b64 list>        add historical presses (with labels) from HA history
  stats                      JSON for sensor.fluentpet_scores
  prune [days]               delete clips older than N days (default 30)

Every write takes a lock and replaces the file atomically, so concurrent presses are safe.
The file is the record: HA history keeps only ~10 days. It is gitignored (ha-config is public).
"""
import base64
import datetime as dt
import fcntl
import json
import os
import re
import secrets as pysecrets
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get("FP_BASE", "/config/fluentpet")
LOG = os.path.join(BASE, "presses.jsonl")
LOCK = os.path.join(BASE, ".presses.lock")
RECORDING = os.path.join(BASE, ".recording.json")  # which Frisbee press is recording, and until when
RECORD_SECS = 120  # must match camera.record duration in packages/fluentpet.yaml
CLIPS = os.path.join(BASE, "clips")
MEDIA_LINK = os.environ.get("FP_MEDIA_LINK", "/media/fluentpet")
SECRETS = os.environ.get("FP_SECRETS", "/config/secrets.yaml")
NTFY_SERVER = os.environ.get("FP_NTFY_SERVER", "https://ntfy.mattmariani.com")
NTFY_TOPIC = os.environ.get("FP_NTFY_TOPIC", "billy-buttons")
NTFY_DRY = os.environ.get("FP_NTFY_DRY") == "1"
LABELS = ("meant", "unclear", "accidental", "me")
SCORE_MIN_LABELS = 10
MAX_ATTACH = 14 * 1024 * 1024  # ntfy server limit is 15 MB per file


# ───────────────────────── helpers ─────────────────────────

def out(obj):
    print(json.dumps(obj, ensure_ascii=False))


def b64json(s):
    return json.loads(base64.b64decode(s).decode("utf-8"))


def now_utc():
    return dt.datetime.now(dt.timezone.utc)


def parse_ts(s):
    if not s:
        return None
    try:
        return dt.datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except ValueError:
        return None


def local_hm(ts):
    t = parse_ts(ts)
    return t.astimezone().strftime("%-I:%M %p").lower() if t else "?"


def ensure_dirs():
    os.makedirs(CLIPS, exist_ok=True)
    # /media is not a mounted volume in this container, so it is lost when the container is
    # recreated. Keep the clips under /config and expose them in the media browser via a link.
    try:
        if os.path.isdir(os.path.dirname(MEDIA_LINK)) and not os.path.lexists(MEDIA_LINK):
            os.symlink(CLIPS, MEDIA_LINK)
    except OSError:
        pass


class Locked:
    def __enter__(self):
        os.makedirs(BASE, exist_ok=True)
        self.f = open(LOCK, "a")
        fcntl.flock(self.f, fcntl.LOCK_EX)
        return self

    def __exit__(self, *a):
        fcntl.flock(self.f, fcntl.LOCK_UN)
        self.f.close()


def read_lines():
    if not os.path.exists(LOG):
        return []
    rows = []
    with open(LOG, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError:
                    rows.append({"type": "corrupt", "raw": line})
    return rows


def write_lines(rows):
    tmp = LOG + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, LOG)


def append_line(row):
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")
        f.flush()
        os.fsync(f.fileno())


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-") or "press"


def new_id(ts, word):
    t = parse_ts(ts) or now_utc()
    return "fp-%s-%s-%s" % (t.astimezone().strftime("%Y%m%d-%H%M%S"), slug(word), pysecrets.token_hex(2))


def find(rows, pid):
    for r in rows:
        if r.get("id") == pid:
            return r
    return None


def read_secret(name):
    try:
        with open(SECRETS, encoding="utf-8") as f:
            for line in f:
                m = re.match(r"^%s:\s*['\"]?([^'\"\s#]+)" % re.escape(name), line)
                if m:
                    return m.group(1)
    except OSError:
        pass
    return None


# ───────────────────────── commands ─────────────────────────

def cmd_log(arg):
    p = b64json(arg)
    ensure_dirs()
    with Locked():
        rows = read_lines()
        key = (p.get("normalized") or p.get("word", "").lower(), p.get("occurred_at"))
        for r in rows:
            if r.get("type") == "press" and (r.get("normalized"), r.get("ts")) == key:
                return out({"duplicate": True, "id": r["id"], "token": r.get("token")})
        teacher = p.get("by_type") == "teacher"
        row = {
            "type": "press",
            "id": new_id(p.get("occurred_at"), p.get("word")),
            "ts": p.get("occurred_at"),
            "logged_at": now_utc().isoformat(),
            "word": p.get("word"),
            "normalized": key[0],
            "kind": p.get("kind") or "other",
            "by": p.get("by_name"),
            "by_type": p.get("by_type"),
            "interaction_id": p.get("interaction_id"),
            "press_order": p.get("press_order"),
            "replayed": bool(p.get("replayed")),
            "entity": p.get("entity"),
            "scored": not teacher,
            "context": {"status": "none" if teacher else "pending"},
            "label": "me" if teacher else None,
            "label_at": now_utc().isoformat() if teacher else None,
            "label_by": "fluentpet teacher" if teacher else None,
            "token": pysecrets.token_urlsafe(9),
        }
        # Frisbee: the camera can record only one clip at a time. A press while a clip is
        # still recording shares that clip instead of starting (and failing) a second one.
        record = False
        if row["kind"] == "frisbee" and not teacher:
            busy = None
            try:
                with open(RECORDING) as f:
                    busy = json.load(f)
            except (OSError, ValueError):
                pass
            if busy and busy.get("until", 0) > time.time():
                row["context"]["clip_shared_with"] = busy.get("id")
            else:
                record = True
                with open(RECORDING, "w") as f:
                    json.dump({"id": row["id"], "until": time.time() + RECORD_SECS + 10}, f)
        append_line(row)
    out({"duplicate": False, "id": row["id"], "token": row["token"], "kind": row["kind"],
         "record": record})


def cmd_drink(arg):
    p = b64json(arg)
    with Locked():
        rows = read_lines()
        ts = p.get("ts")
        if any(r.get("type") == "drink_button" and r.get("ts") == ts for r in rows):
            return out({"duplicate": True})
        append_line({"type": "drink_button", "id": "db-" + pysecrets.token_hex(4), "ts": ts,
                     "event_type": p.get("event_type"), "logged_at": now_utc().isoformat()})
    out({"duplicate": False})


def cmd_context(pid, arg):
    ctx = b64json(arg)
    with Locked():
        rows = read_lines()
        r = find(rows, pid)
        if not r:
            return out({"ok": False, "error": "no such press"})
        c = dict(r.get("context") or {})
        c.update(ctx)
        c["status"] = "done"
        r["context"] = c
        write_lines(rows)
    out({"ok": True, "context": c})


def cmd_clip_bg(pid):
    """Start clip + notify in a detached process and return at once (shell_command has a 60 s limit;
    waiting for the clip and making the snapshot takes about 2 min on the CM4)."""
    subprocess.Popen([sys.executable, os.path.abspath(__file__), "clip_notify", pid],
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     start_new_session=True, close_fds=True)
    out({"ok": True, "started": "clip_notify", "id": pid})


def cmd_clip_notify(pid):
    try:
        cmd_clip(pid)
    finally:
        cmd_notify(pid)  # always ask, with or without a clip


def cmd_clip(pid):
    ensure_dirs()
    clip = os.path.join(CLIPS, pid + ".mp4")
    shared = ((find(read_lines(), pid) or {}).get("context") or {}).get("clip_shared_with")
    if shared and not os.path.exists(clip):
        clip = os.path.join(CLIPS, shared + ".mp4")  # the press that started the recording
    # camera.record finishes writing after its duration; wait for the size to settle.
    last, stable = -1, 0
    for _ in range(45):
        size = os.path.getsize(clip) if os.path.exists(clip) else -1
        if size > 0 and size == last:
            stable += 1
            if stable >= 2:
                break
        else:
            stable = 0
        last = size
        time.sleep(2)
    ctx = {}
    if os.path.exists(clip) and os.path.getsize(clip) > 0:
        ctx["clip"] = "/media/fluentpet/" + os.path.basename(clip)
        ctx["clip_mb"] = round(os.path.getsize(clip) / 1e6, 1)
        if shared and os.path.basename(clip) != pid + ".mp4":
            ctx["clip_shared"] = True
    else:
        # Another Frisbee press may already be recording (one recording per camera at a time):
        # use the newest clip that started within the last 3 minutes.
        cands = sorted((f for f in os.listdir(CLIPS) if f.endswith(".mp4")),
                       key=lambda f: os.path.getmtime(os.path.join(CLIPS, f)), reverse=True)
        recent = [f for f in cands if time.time() - os.path.getmtime(os.path.join(CLIPS, f)) < 180]
        if recent:
            clip = os.path.join(CLIPS, recent[0])
            ctx["clip"] = "/media/fluentpet/" + recent[0]
            ctx["clip_shared"] = True
        else:
            ctx["clip"] = None
            ctx["clip_error"] = "no recording (camera busy or unavailable)"
    if ctx.get("clip"):
        snap = os.path.join(CLIPS, pid + ".jpg")
        try:
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", "45", "-i", clip,
                            "-frames:v", "1", "-vf", "scale=960:-2", "-q:v", "5", snap],
                           timeout=60, check=False)
            if not os.path.exists(snap):  # short clip: take the first frame instead
                subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", clip, "-frames:v", "1",
                                "-vf", "scale=960:-2", "-q:v", "5", snap], timeout=60, check=False)
        except (OSError, subprocess.TimeoutExpired):
            pass
        if os.path.exists(snap):
            ctx["snapshot"] = "/media/fluentpet/%s.jpg" % pid
    cmd_context(pid, base64.b64encode(json.dumps(ctx).encode()).decode())


def describe_context(r):
    c = r.get("context") or {}
    k = r.get("kind")
    if k == "frisbee":
        if c.get("clip"):
            return "Clip saved (%s)%s." % (c["clip"].rsplit("/", 1)[-1], ", shared with an earlier press" if c.get("clip_shared") else "")
        return "No clip: %s." % c.get("clip_error", "camera unavailable")
    if k == "water":
        if c.get("drink_confirmed"):
            return "Drink confirmed by the water button at %s." % local_hm(c.get("drink_at"))
        return "No drink confirmation within 5 min."
    if k == "outside":
        if c.get("back_door") == "sensor unavailable":
            return "Back door sensor unavailable, so no context."
        if c.get("back_door_opened"):
            return "Back door opened %s min later." % c.get("minutes", "?")
        return "Back door did not open within 10 min."
    return ""


def _notify(pid):
    """Send the ntfy push for one press; returns the result dict."""
    rows = read_lines()
    r = find(rows, pid)
    if not r:
        return ({"ok": False, "error": "no such press"})
    title = "Billy pressed %s" % r.get("word")
    lines = ["%s at %s." % (r.get("word"), local_hm(r.get("ts")))]
    ctx = describe_context(r)
    if ctx:
        lines.append(ctx)
    if r.get("replayed"):
        lines.append("(Delivered late by FluentPet.)")
    label_url = read_secret("fluentpet_label_url")
    if not label_url:
        lines.append("Label it on the HA FluentPet dashboard (Meant / Unclear / Accidental / Me).")
    message = " ".join(lines)
    token = read_secret("ntfy_billy_token")
    if not token and not NTFY_DRY:
        return ({"ok": False, "error": "ntfy_billy_token missing from secrets"})
    headers = {"Authorization": "Bearer %s" % token, "Title": title, "Tags": "dog"}
    if label_url:
        # Tap route (on hold as of 2026-11-22). ntfy allows at most 3 actions per message.
        acts = [{"action": "http", "label": lab.capitalize(), "url": label_url, "method": "POST",
                 "headers": {"Content-Type": "application/json"}, "clear": True,
                 "body": json.dumps({"id": pid, "token": r.get("token"), "label": lab})}
                for lab in ("meant", "unclear", "accidental")]
        headers["Actions"] = json.dumps(acts)
    snap = None
    c = r.get("context") or {}
    if c.get("snapshot"):
        snap = os.path.join(CLIPS, c["snapshot"].rsplit("/", 1)[-1])
        if not os.path.exists(snap) or os.path.getsize(snap) > MAX_ATTACH:
            snap = None
    url = "%s/%s" % (NTFY_SERVER.rstrip("/"), NTFY_TOPIC)
    if snap:
        headers["Filename"] = os.path.basename(snap)
        headers["Message"] = message.encode("ascii", "replace").decode()
        with open(snap, "rb") as f:
            body, method = f.read(), "PUT"
    else:
        body, method = message.encode("utf-8"), "POST"
    if NTFY_DRY:
        return ({"ok": True, "dry_run": True, "method": method, "url": url,
                    "headers": {k: v for k, v in headers.items() if k != "Authorization"},
                    "message": message, "attachment": os.path.basename(snap) if snap else None})
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            status = resp.status
    except urllib.error.HTTPError as e:
        return ({"ok": False, "status": e.code, "error": e.read().decode(errors="replace")[:200]})
    except (urllib.error.URLError, OSError) as e:
        return ({"ok": False, "error": str(e)[:200]})
    return {"ok": status == 200, "status": status, "attachment": os.path.basename(snap) if snap else None}


def cmd_notify(pid):
    res = _notify(pid)
    # Keep the push result on the press's line (the weekly review counts failed pushes).
    with Locked():
        rows = read_lines()
        r = find(rows, pid)
        if r:
            r["notify"] = {"at": now_utc().isoformat(), "ok": bool(res.get("ok")),
                           "status": res.get("status"), "error": res.get("error")}
            write_lines(rows)
    out(res)


def _set_label(r, label, by):
    r.setdefault("label_history", [])
    if r.get("label"):
        r["label_history"].append({"label": r["label"], "at": r.get("label_at"), "by": r.get("label_by")})
    r["label"] = label
    r["label_at"] = now_utc().isoformat()
    r["label_by"] = by
    r["scored"] = label != "me"


def cmd_label(pid, label, token=None):
    label = (label or "").lower()
    if label not in LABELS:
        return out({"ok": False, "error": "label must be one of %s" % ", ".join(LABELS)})
    with Locked():
        rows = read_lines()
        r = find(rows, pid)
        if not r or r.get("type") != "press":
            return out({"ok": False, "error": "no such press"})
        if token not in (None, "", "-") and token != r.get("token"):
            return out({"ok": False, "error": "token mismatch"})
        _set_label(r, label, "ntfy" if token not in (None, "", "-") else "ha")
        write_lines(rows)
    out({"ok": True, "id": pid, "word": r.get("word"), "label": label})


def cmd_label_latest(label):
    label = (label or "").lower()
    if label not in LABELS:
        return out({"ok": False, "error": "label must be one of %s" % ", ".join(LABELS)})
    with Locked():
        rows = read_lines()
        pend = [r for r in rows if r.get("type") == "press" and r.get("scored") and not r.get("label")]
        if not pend:
            return out({"ok": False, "error": "nothing to label"})
        r = max(pend, key=lambda x: x.get("ts") or "")
        _set_label(r, label, "ha dashboard")
        write_lines(rows)
    out({"ok": True, "id": r["id"], "word": r.get("word"), "label": label})


def cmd_backfill(arg):
    items = b64json(arg)
    added = 0
    with Locked():
        rows = read_lines()
        have = {(r.get("normalized"), r.get("ts")) for r in rows if r.get("type") == "press"}
        have_d = {r.get("ts") for r in rows if r.get("type") == "drink_button"}
        for p in items:
            if p.get("type") == "drink_button":
                if p.get("ts") in have_d:
                    continue
                rows.append({"type": "drink_button", "id": "db-" + pysecrets.token_hex(4), "ts": p["ts"],
                             "event_type": p.get("event_type"), "logged_at": now_utc().isoformat(),
                             "backfilled": True, "note": p.get("note")})
                added += 1
                continue
            key = (p.get("normalized"), p.get("occurred_at"))
            if key in have:
                continue
            label = p.get("label")
            rows.append({
                "type": "press", "id": new_id(p.get("occurred_at"), p.get("word")),
                "ts": p.get("occurred_at"), "logged_at": now_utc().isoformat(),
                "word": p.get("word"), "normalized": p.get("normalized"), "kind": p.get("kind") or "other",
                "by": p.get("by_name"), "by_type": p.get("by_type"),
                "interaction_id": p.get("interaction_id"), "press_order": p.get("press_order"),
                "replayed": bool(p.get("replayed")), "entity": p.get("entity"),
                "scored": label != "me",
                "context": dict(p.get("context") or {}, status="done", backfilled=True),
                "label": label, "label_at": now_utc().isoformat() if label else None,
                "label_by": p.get("label_by") or ("backfill" if label else None),
                "token": pysecrets.token_urlsafe(9), "backfilled": True, "note": p.get("note"),
            })
            have.add(key)
            added += 1
        rows.sort(key=lambda r: r.get("ts") or "")
        write_lines(rows)
    out({"ok": True, "added": added})


def cmd_stats():
    rows = read_lines()
    presses = [r for r in rows if r.get("type") == "press"]
    now = now_utc().astimezone()
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_ago = now - dt.timedelta(days=7)
    words = {}
    for r in presses:
        w = r.get("word") or "?"
        d = words.setdefault(w, {"kind": r.get("kind"), "presses": 0, "today": 0, "last_7d": 0,
                                 "labelled": 0, "meant": 0, "unclear": 0, "accidental": 0, "me": 0,
                                 "unlabelled": 0, "last": None})
        lab = r.get("label")
        if lab == "me" or r.get("by_type") == "teacher":
            d["me"] += 1
            continue  # teacher / Matt presses never count
        t = parse_ts(r.get("ts"))
        d["presses"] += 1
        if t and t >= midnight:
            d["today"] += 1
        if t and t >= week_ago:
            d["last_7d"] += 1
        if lab in ("meant", "unclear", "accidental"):
            d["labelled"] += 1
            d[lab] += 1
        else:
            d["unlabelled"] += 1
        if t and (d["last"] is None or r.get("ts") > d["last"]):
            d["last"] = r.get("ts")
    for d in words.values():
        d["per_day_7d"] = round(d["last_7d"] / 7, 1)
        d["score"] = round(d["meant"] / d["labelled"], 2) if d["labelled"] >= SCORE_MIN_LABELS else None
        d["score_text"] = ("%d%% meant (%d/%d)" % (round(100 * d["meant"] / d["labelled"]), d["meant"], d["labelled"])
                           if d["labelled"] >= SCORE_MIN_LABELS
                           else "%d/%d labels" % (d["labelled"], SCORE_MIN_LABELS))
    pend = sorted((r for r in presses if r.get("scored") and not r.get("label")),
                  key=lambda r: r.get("ts") or "", reverse=True)
    pending = [{"id": r["id"], "word": r.get("word"), "time": local_hm(r.get("ts")),
                "context": describe_context(r)} for r in pend[:5]]
    out({"updated": now.isoformat(timespec="seconds"),
         "today_total": sum(d["today"] for d in words.values()),
         "words": words, "pending": pending, "pending_count": len(pend),
         "drink_buttons_today": sum(1 for r in rows if r.get("type") == "drink_button"
                                    and (parse_ts(r.get("ts")) or now) >= midnight)})


def cmd_prune(days="30"):
    days = int(days) if str(days).isdigit() else 30
    cutoff = time.time() - days * 86400
    removed = 0
    if os.path.isdir(CLIPS):
        for f in os.listdir(CLIPS):
            p = os.path.join(CLIPS, f)
            if os.path.isfile(p) and os.path.getmtime(p) < cutoff:
                os.remove(p)
                removed += 1
    out({"ok": True, "removed": removed})


def main(argv):
    if not argv:
        print(__doc__)
        return 2
    cmd, args = argv[0], [a for a in argv[1:] if a != "-"]
    table = {
        "log": lambda: cmd_log(args[0]),
        "drink": lambda: cmd_drink(args[0]),
        "context": lambda: cmd_context(args[0], args[1]),
        "clip": lambda: cmd_clip(args[0]),
        "notify": lambda: cmd_notify(args[0]),
        "clip_bg": lambda: cmd_clip_bg(args[0]),
        "clip_notify": lambda: cmd_clip_notify(args[0]),
        "label": lambda: cmd_label(args[0], args[1], args[2] if len(args) > 2 else None),
        "label_latest": lambda: cmd_label_latest(args[0]),
        "backfill": lambda: cmd_backfill(args[0]),
        "stats": cmd_stats,
        "prune": lambda: cmd_prune(args[0] if args else "30"),
        "ensure_dirs": lambda: (ensure_dirs(), out({"ok": True})),
    }
    if cmd not in table:
        out({"ok": False, "error": "unknown command %s" % cmd})
        return 2
    try:
        table[cmd]()
    except (IndexError, ValueError) as e:
        out({"ok": False, "error": "bad arguments: %s" % e})
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
