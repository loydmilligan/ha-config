#!/usr/bin/env python3
"""Office camera vision classifier, run by Home Assistant's shell_command.

classify  resize a snapshot, ask OpenRouter, validate, match household, log cost
totals    cost and last-result JSON for the dashboard sensor
report    spending per day, camera and model

Every classify run prints one JSON object. `person_present` is true or false only
after a valid classification; every failure reports null, so Home Assistant can
never read a failed call as "nobody is here".
"""
import argparse
import base64
import datetime as dt
import fcntl
import hashlib
import io
import json
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
API_URL = "https://openrouter.ai/api/v1/chat/completions"
CATALOG_URL = "https://openrouter.ai/api/v1/models"
USER_AGENT = "ha-office-vision/1.0"
HAIR = ("short", "medium", "long", "unknown")
HEIGHT = ("taller", "shorter", "unknown")
API_FAILURES = ("api_error", "invalid_response")

DEFAULTS = {
    "provider": "openrouter",
    "model": "anthropic/claude-haiku-5.5",
    "request_timeout_seconds": 20,
    "max_output_tokens": 150,
    "image": {"max_dimension": 512, "jpeg_quality": 70, "max_age_seconds": 20},
    "classification": {"detect_dog": True, "detect_characteristics": True, "household_matching": True},
    "change_detection": {"enabled": True, "pixel_delta": 18, "min_changed_fraction": 0.02, "max_reuse_seconds": 60},
    "cost": {"daily_limit_usd": 0.25},
    "backoff": {"base_seconds": 30, "max_seconds": 600},
    "matching": {"min_score": 1, "min_margin": 1},
    "db_path": "/config/office_vision_usage.db",
    "secrets_path": "/config/secrets.yaml",
}


def merge(base, over):
    out = dict(base)
    for key, value in (over or {}).items():
        out[key] = merge(out[key], value) if isinstance(value, dict) and isinstance(out.get(key), dict) else value
    return out


def load_config(path=None):
    import yaml
    path = path or os.path.join(HERE, "config.yaml")
    with open(path) as handle:
        return merge(DEFAULTS, (yaml.safe_load(handle) or {}).get("vision"))


def load_profiles(path=None):
    import yaml
    path = path or os.path.join(HERE, "household.yaml")
    if not os.path.exists(path):
        return {}
    with open(path) as handle:
        return (yaml.safe_load(handle) or {}).get("household") or {}


def api_key(cfg):
    if os.environ.get("OPENROUTER_API_KEY"):
        return os.environ["OPENROUTER_API_KEY"].strip()
    import yaml
    with open(cfg["secrets_path"]) as handle:
        return str((yaml.safe_load(handle) or {}).get("openrouter_api_key") or "").strip()


# ---- image ----------------------------------------------------------------

def optimize_image(path, max_dimension, quality):
    from PIL import Image
    with Image.open(path) as img:
        img = img.convert("RGB")
        img.thumbnail((max_dimension, max_dimension), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=quality, optimize=True)
        return buf.getvalue(), img.size


def fingerprint(path):
    from PIL import Image
    with Image.open(path) as img:
        return img.convert("L").resize((32, 18), Image.BILINEAR).tobytes()


def scene_changed(old, new, pixel_delta, min_changed_fraction):
    if len(old) != len(new) or not new:
        return True
    moved = sum(1 for a, b in zip(old, new) if abs(a - b) >= pixel_delta)
    return moved / len(new) >= min_changed_fraction


# ---- request and validation -----------------------------------------------

def build_prompt(cfg):
    c = cfg["classification"]
    text = "Analyze this camera image. Count real visible people (0-2, use 2 for more; ignore screens and photos)"
    if c["detect_dog"]:
        text += ", determine whether a dog is present"
    if c["detect_characteristics"]:
        text += ", and report visible characteristics of each person"
    return text + ". Return only structured JSON. Use unknown when uncertain. Do not infer identity."


def build_schema(cfg):
    c = cfg["classification"]
    person = {
        "type": "object",
        "properties": {
            "hair": {"type": "string", "enum": list(HAIR)},
            "height": {"type": "string", "enum": list(HEIGHT)},
            "clothing": {"type": "string"},
        },
        "required": ["hair", "height", "clothing"],
        "additionalProperties": False,
    }
    props = {"people": {"type": "integer", "enum": [0, 1, 2]}}
    if c["detect_dog"]:
        props["dog"] = {"type": "boolean"}
    if c["detect_characteristics"]:
        props["persons"] = {"type": "array", "items": person}
    return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}


def validate_response(obj, cfg):
    """Return a normalized observation, or raise ValueError on anything off-schema."""
    c = cfg["classification"]
    if not isinstance(obj, dict):
        raise ValueError("not an object")
    want = {"people"} | ({"dog"} if c["detect_dog"] else set()) | ({"persons"} if c["detect_characteristics"] else set())
    if set(obj) != want:
        raise ValueError("wrong keys")
    people = obj["people"]
    if isinstance(people, bool) or not isinstance(people, int) or not 0 <= people <= 2:
        raise ValueError("bad people count")
    dog = obj.get("dog", False)
    if not isinstance(dog, bool):
        raise ValueError("bad dog value")
    persons = []
    if c["detect_characteristics"]:
        if not isinstance(obj["persons"], list) or len(obj["persons"]) != people:
            raise ValueError("persons does not match people")
        for item in obj["persons"]:
            if not isinstance(item, dict) or set(item) != {"hair", "height", "clothing"}:
                raise ValueError("bad person")
            if item["hair"] not in HAIR or item["height"] not in HEIGHT or not isinstance(item["clothing"], str):
                raise ValueError("bad person value")
            persons.append({"hair": item["hair"], "height": item["height"], "clothing": item["clothing"][:40]})
    return {"people": people, "dog": dog, "persons": persons}


def http_post(url, body, headers, timeout):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST", headers=headers)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(req, timeout=timeout) as resp:
        return json.load(resp)


def call_model(cfg, model, jpeg, key, post=http_post):
    """Return (validated observation, usage dict, duration ms). Raises on failure."""
    body = {
        "model": model,
        "max_tokens": cfg["max_output_tokens"],
        "usage": {"include": True},
        "provider": {"data_collection": "deny", "require_parameters": True},
        "response_format": {"type": "json_schema", "json_schema": {"name": "camera_observation", "strict": True, "schema": build_schema(cfg)}},
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": build_prompt(cfg)},
            {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(jpeg).decode()}},
        ]}],
    }
    headers = {"Authorization": "Bearer " + key, "Content-Type": "application/json", "User-Agent": USER_AGENT, "X-Title": "HA Office Vision"}
    start = time.monotonic()
    data = post(API_URL, body, headers, cfg["request_timeout_seconds"])
    duration = int((time.monotonic() - start) * 1000)
    usage = data.get("usage") or {}
    content = (((data.get("choices") or [{}])[0].get("message") or {}).get("content") or "").strip()
    if content.startswith("```"):
        content = content.strip("`").removeprefix("json").strip()
    try:
        return validate_response(json.loads(content), cfg), usage, duration
    except ValueError as err:
        raise InvalidResponse(str(err), usage, duration) from None


class InvalidResponse(Exception):
    def __init__(self, message, usage, duration):
        super().__init__(message)
        self.usage, self.duration = usage, duration


# ---- household matching (separate from what the model observed) ------------

def _score(person, profile, use_height):
    score = evidence = 0
    for observed, wanted, usable in ((person["hair"], profile.get("hair", "unknown"), True),
                                     (person["height"], profile.get("relative_height", "unknown"), use_height)):
        if usable and observed != "unknown" and wanted != "unknown":
            evidence += 1
            score += 1 if observed == wanted else -1
    return score, evidence


def _best(person, profiles, use_height, cfg):
    ranked = sorted(((*_score(person, p, use_height), name) for name, p in profiles.items()), reverse=True)
    top, evidence, name = ranked[0]
    second = ranked[1][0] if len(ranked) > 1 else None
    if top < cfg["min_score"] or (second is not None and top - second < cfg["min_margin"]):
        return None, 0
    return name, evidence


def match_household(obs, profiles, cfg):
    """Conservatively map an observation to member_a, member_b, both, none or unknown.

    One matching trait is reported as a guess (confirmed false). Height is only
    compared when two people are in frame, since otherwise there is nothing to
    compare it against.
    """
    unknown = {"classification": "unknown", "uncertainty": "high", "confirmed": False}
    if obs["people"] == 0:
        return {"classification": "none", "uncertainty": "low", "confirmed": True}
    usable = {n: p for n, p in profiles.items() if any(p.get(k, "unknown") != "unknown" for k in ("hair", "relative_height"))}
    if not usable or len(obs["persons"]) != obs["people"]:
        return unknown
    use_height = obs["people"] == 2
    picks = [_best(person, usable, use_height, cfg) for person in obs["persons"]]
    if any(name is None for name, _ in picks):
        return unknown
    if obs["people"] == 1:
        name, evidence = picks[0]
        return {"classification": name, "uncertainty": "medium" if evidence >= 2 else "high", "confirmed": evidence >= 2}
    if picks[0][0] == picks[1][0]:
        return unknown
    confirmed = all(evidence >= 2 for _, evidence in picks)
    return {"classification": "both", "uncertainty": "medium" if confirmed else "high", "confirmed": confirmed}


# ---- usage log --------------------------------------------------------------

class Store:
    COLUMNS = ("ts", "camera", "source", "model", "width", "height", "input_tokens", "output_tokens",
               "cost_usd", "cost_source", "duration_ms", "status", "people", "dog", "member", "uncertainty", "summary")

    def __init__(self, path):
        self.db = sqlite3.connect(path, timeout=5)
        self.db.row_factory = sqlite3.Row
        self.db.execute(
            "CREATE TABLE IF NOT EXISTS calls (id INTEGER PRIMARY KEY, ts REAL, camera TEXT, source TEXT, model TEXT,"
            " width INT, height INT, input_tokens INT, output_tokens INT, cost_usd REAL, cost_source TEXT,"
            " duration_ms INT, status TEXT, people INT, dog INT, member TEXT, uncertainty TEXT, summary TEXT)")
        self.db.execute("CREATE INDEX IF NOT EXISTS calls_ts ON calls(ts)")
        self.db.execute("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)")
        self.db.commit()

    def get(self, key, default=None):
        row = self.db.execute("SELECT v FROM kv WHERE k=?", (key,)).fetchone()
        return json.loads(row["v"]) if row else default

    def put(self, key, value):
        self.db.execute("INSERT OR REPLACE INTO kv VALUES (?,?)", (key, json.dumps(value)))
        self.db.commit()

    def record(self, **row):
        values = [row.get(c) for c in self.COLUMNS]
        self.db.execute(f"INSERT INTO calls ({','.join(self.COLUMNS)}) VALUES ({','.join('?' * len(values))})", values)
        self.db.commit()

    def spent(self, since):
        row = self.db.execute(
            "SELECT COALESCE(SUM(cost_usd),0) c, SUM(status='ok') n, SUM(status='reused') r FROM calls WHERE ts>=?", (since,)).fetchone()
        return {"cost": row["c"], "calls": row["n"] or 0, "reused": row["r"] or 0}

    def last(self, where="1=1"):
        return self.db.execute(f"SELECT * FROM calls WHERE {where} ORDER BY id DESC LIMIT 1").fetchone()


def period_starts(now):
    today = dt.datetime.fromtimestamp(now).date()
    def stamp(day):
        return dt.datetime(day.year, day.month, day.day).timestamp()
    return stamp(today), stamp(today - dt.timedelta(days=today.weekday())), stamp(today.replace(day=1))


def backoff_wait(failures, cfg):
    if failures <= 0:
        return 0
    return min(cfg["backoff"]["max_seconds"], cfg["backoff"]["base_seconds"] * 2 ** (failures - 1))


def model_price(store, model, fetch=None):
    """(prompt, completion) USD per token from a one-day cache of the public catalog."""
    cached = store.get("price:" + model)
    if cached and time.time() - cached["ts"] < 86400:
        return cached["prompt"], cached["completion"]
    try:
        if fetch is None:
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            req = urllib.request.Request(CATALOG_URL, headers={"User-Agent": USER_AGENT})
            fetch = lambda: json.load(opener.open(req, timeout=10))["data"]
        for item in fetch():
            if item["id"] == model:
                price = {"ts": time.time(), "prompt": float(item["pricing"]["prompt"]), "completion": float(item["pricing"]["completion"])}
                store.put("price:" + model, price)
                return price["prompt"], price["completion"]
    except Exception:
        pass
    return None


def resolve_cost(usage, store, model, fetch=None):
    """Actual cost when OpenRouter reports it, otherwise an estimate from token counts."""
    if isinstance(usage.get("cost"), (int, float)) and not isinstance(usage.get("cost"), bool):
        return float(usage["cost"]), "actual"
    price = model_price(store, model, fetch)
    if price and (usage.get("prompt_tokens") or usage.get("completion_tokens")):
        return (usage.get("prompt_tokens") or 0) * price[0] + (usage.get("completion_tokens") or 0) * price[1], "estimated"
    return None, "unavailable"


# ---- classify -----------------------------------------------------------------

def summarize(obs, member):
    count = {0: "No people", 1: "1 person", 2: "2 people"}[obs["people"]]
    text = f"{count}, {'dog' if obs['dog'] else 'no dog'}"
    if obs["people"]:
        guess = member["classification"]
        text += f"; {guess}" + ("" if member["confirmed"] else " (unconfirmed)")
    return text


def failure(status, message, **extra):
    return {"status": status, "person_present": None, "summary": message, "reused": False, **extra}


def classify(cfg, image, camera, source, now=None, post=http_post, profiles=None, key=None, fetch=None):
    now = time.time() if now is None else now
    os.makedirs(os.path.dirname(cfg["db_path"]) or ".", exist_ok=True)
    lock = open(cfg["db_path"] + ".lock", "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return failure("busy", "Another check is already running")
    try:
        return _classify(cfg, image, camera, source, now, post, profiles, key, fetch)
    finally:
        lock.close()


def _classify(cfg, image, camera, source, now, post, profiles, key, fetch):
    store = Store(cfg["db_path"])
    base = {"ts": now, "camera": camera, "source": source, "model": cfg["model"]}

    try:
        age = now - os.path.getmtime(image)
        with open(image, "rb") as handle:
            raw = handle.read()
    except OSError:
        age, raw = None, b""
    if age is None or age > cfg["image"]["max_age_seconds"]:
        store.record(**base, status="camera_error", summary="Snapshot missing or stale")
        return failure("camera_error", "Camera snapshot failed or is stale")

    today = period_starts(now)[0]
    if store.spent(today)["cost"] >= cfg["cost"]["daily_limit_usd"]:
        store.record(**base, status="budget_exhausted", summary="Daily limit reached")
        return failure("budget_exhausted", "Daily spending limit reached; no AI calls until midnight")

    failures = store.get("fail_count", 0)
    if failures and now - store.get("fail_ts", 0) < backoff_wait(failures, cfg):
        return failure("backoff", f"Waiting after {failures} failed AI call(s)")

    sha = hashlib.sha256(raw).hexdigest()
    finger = fingerprint(image)
    change = cfg["change_detection"]
    previous = store.get("last_ok")
    if change["enabled"] and previous and now - previous["ts"] < change["max_reuse_seconds"]:
        same = previous["sha"] == sha or not scene_changed(bytes.fromhex(previous["fp"]), finger, change["pixel_delta"], change["min_changed_fraction"])
        if same:
            result = dict(previous["result"], status="reused", reused=True, cost_usd=0.0, cost_source="none")
            store.record(**base, status="reused", cost_usd=0.0, cost_source="none", people=result["people"], dog=int(result["dog"]),
                         member=result["member"]["classification"], uncertainty=result["member"]["uncertainty"], summary=result["summary"])
            return result

    jpeg, (width, height) = optimize_image(image, cfg["image"]["max_dimension"], cfg["image"]["jpeg_quality"])
    base.update(width=width, height=height)
    try:
        key = key if key is not None else api_key(cfg)
        obs, usage, duration = call_model(cfg, cfg["model"], jpeg, key, post)
    except InvalidResponse as err:
        return _failed(store, base, "invalid_response", "AI returned an invalid answer", now, err.usage, err.duration, fetch)
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, KeyError, IndexError, TypeError, AttributeError) as err:
        code = getattr(err, "code", None)
        message = f"AI call failed (HTTP {code})" if code else f"AI call failed ({type(err).__name__})"
        return _failed(store, base, "api_error", message, now, {}, None, fetch)

    profile_set = load_profiles() if profiles is None else profiles
    if cfg["classification"]["household_matching"]:
        member = match_household(obs, profile_set, cfg["matching"])
    else:
        member = {"classification": "unknown", "uncertainty": "high", "confirmed": False}
    cost, source_of_cost = resolve_cost(usage, store, cfg["model"], fetch)
    result = {
        "status": "ok", "reused": False, "person_present": obs["people"] >= 1, "people": obs["people"], "dog": obs["dog"],
        "persons": obs["persons"], "member": member, "summary": summarize(obs, member), "model": cfg["model"],
        "cost_usd": cost, "cost_source": source_of_cost, "input_tokens": usage.get("prompt_tokens"),
        "output_tokens": usage.get("completion_tokens"), "duration_ms": duration, "width": width, "height": height,
    }
    store.record(**base, input_tokens=result["input_tokens"], output_tokens=result["output_tokens"], cost_usd=cost, cost_source=source_of_cost,
                 duration_ms=duration, status="ok", people=obs["people"], dog=int(obs["dog"]), member=member["classification"],
                 uncertainty=member["uncertainty"], summary=result["summary"])
    store.put("fail_count", 0)
    store.put("last_ok", {"ts": now, "sha": sha, "fp": finger.hex(), "result": result})
    return result


def _failed(store, base, status, message, now, usage, duration, fetch):
    cost, cost_source = resolve_cost(usage, store, base["model"], fetch) if usage else (None, "none")
    store.record(**base, status=status, summary=message, input_tokens=usage.get("prompt_tokens"), output_tokens=usage.get("completion_tokens"),
                 cost_usd=cost, cost_source=cost_source, duration_ms=duration)
    store.put("fail_count", store.get("fail_count", 0) + 1)
    store.put("fail_ts", now)
    return failure(status, message, model=base["model"])


# ---- reporting ------------------------------------------------------------------

def totals(cfg, now=None):
    now = time.time() if now is None else now
    os.makedirs(os.path.dirname(cfg["db_path"]) or ".", exist_ok=True)
    store = Store(cfg["db_path"])
    day, week, month = (store.spent(s) for s in period_starts(now))
    last = store.last("status='ok'")
    latest = store.last()
    out = {
        "today": day["cost"], "week": week["cost"], "month": month["cost"],
        "today_calls": day["calls"], "week_calls": week["calls"], "month_calls": month["calls"], "today_reused": day["reused"],
        "daily_limit": cfg["cost"]["daily_limit_usd"], "failures": store.get("fail_count", 0), "configured_model": cfg["model"],
        "latest_status": latest["status"] if latest else None, "latest_summary": latest["summary"] if latest else None,
        "last_cost": None, "last_cost_source": None, "last_model": None, "last_ts": None, "last_input_tokens": None,
        "last_output_tokens": None, "last_duration_ms": None, "last_width": None, "last_height": None,
        "people": None, "dog": None, "member": None, "uncertainty": None,
    }
    if last:
        out.update(last_cost=last["cost_usd"], last_cost_source=last["cost_source"], last_model=last["model"], last_ts=last["ts"],
                   last_input_tokens=last["input_tokens"], last_output_tokens=last["output_tokens"], last_duration_ms=last["duration_ms"],
                   last_width=last["width"], last_height=last["height"], people=last["people"], dog=bool(last["dog"]),
                   member=last["member"], uncertainty=last["uncertainty"])
    return out


def report(cfg, days=31):
    store = Store(cfg["db_path"])
    rows = store.db.execute(
        "SELECT date(ts,'unixepoch','localtime') day, camera, model, COUNT(*) attempts, SUM(status='ok') ok, SUM(status='reused') reused,"
        " SUM(status IN ('api_error','invalid_response','camera_error')) failed, COALESCE(SUM(cost_usd),0) cost"
        " FROM calls WHERE ts>=? GROUP BY day, camera, model ORDER BY day DESC", (time.time() - days * 86400,)).fetchall()
    return [dict(r) for r in rows]


def main(argv=None):
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    one = sub.add_parser("classify")
    one.add_argument("--image", required=True)
    one.add_argument("--camera", default="office")
    one.add_argument("--source", default="manual")
    sub.add_parser("totals")
    sub.add_parser("report")
    args = parser.parse_args(argv)
    try:
        cfg = load_config()
        if args.cmd == "classify":
            print(json.dumps(classify(cfg, args.image, args.camera, args.source)))
        elif args.cmd == "totals":
            print(json.dumps(totals(cfg)))
        else:
            print(json.dumps(report(cfg), indent=1))
    except Exception as err:
        print(json.dumps(failure("internal_error", f"Classifier error ({type(err).__name__})")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
