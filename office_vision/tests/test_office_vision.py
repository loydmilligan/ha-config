import json
import os
import sys
import tempfile
import time
import unittest
import urllib.error

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import benchmark  # noqa: E402
import office_vision as ov  # noqa: E402
from PIL import Image  # noqa: E402

GOOD = {"people": 1, "dog": False, "persons": [{"hair": "short", "height": "unknown", "clothing": "blue"}]}
EMPTY = {"people": 0, "dog": False, "persons": []}
USAGE = {"prompt_tokens": 300, "completion_tokens": 30, "cost": 0.00005}


def reply(obj, usage=USAGE):
    def post(url, body, headers, timeout):
        post.bodies.append(body)
        return {"choices": [{"message": {"content": json.dumps(obj)}}], "usage": usage}
    post.bodies = []
    return post


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.cfg = ov.merge(ov.DEFAULTS, {"db_path": os.path.join(self.tmp.name, "u.db")})
        self.image = os.path.join(self.tmp.name, "f.jpg")
        self.frame((40, 40, 40))
        self.now = time.time()

    def tearDown(self):
        self.tmp.cleanup()

    def frame(self, color, size=(1280, 720)):
        Image.new("RGB", size, color).save(self.image, "JPEG")

    def run_it(self, post, now=None, profiles=None, cfg=None):
        return ov.classify(cfg or self.cfg, self.image, "office", "test", now=now or self.now, post=post, profiles=profiles or {}, key="k", fetch=lambda: [])


class ImageTests(Base):
    def test_resizes_and_keeps_aspect(self):
        jpeg, size = ov.optimize_image(self.image, 512, 70)
        self.assertEqual(size, (512, 288))
        self.assertTrue(jpeg.startswith(b"\xff\xd8"))

    def test_scene_change(self):
        same = bytes([50] * 576)
        self.assertFalse(ov.scene_changed(same, same, 18, 0.02))
        self.assertTrue(ov.scene_changed(same, bytes([120] * 30 + [50] * 546), 18, 0.02))


class ValidationTests(Base):
    def test_accepts_good(self):
        self.assertEqual(ov.validate_response(GOOD, self.cfg)["people"], 1)

    def test_rejects_off_schema(self):
        for bad in ({**GOOD, "extra": 1}, {**GOOD, "people": 3}, {**GOOD, "people": True}, {**GOOD, "dog": "no"}, {**GOOD, "persons": []},
                    {"people": 1, "dog": False, "persons": [{"hair": "bald", "height": "unknown", "clothing": "x"}]}, []):
            with self.assertRaises(ValueError):
                ov.validate_response(bad, self.cfg)


class MatchingTests(Base):
    P = {"member_a": {"hair": "short", "relative_height": "taller"}, "member_b": {"hair": "long", "relative_height": "shorter"}}

    def match(self, people, persons, profiles=None):
        return ov.match_household({"people": people, "dog": False, "persons": persons}, self.P if profiles is None else profiles, self.cfg["matching"])

    def person(self, hair="unknown", height="unknown"):
        return {"hair": hair, "height": height, "clothing": "x"}

    def test_none(self):
        self.assertEqual(self.match(0, [])["classification"], "none")

    def test_single_trait_is_only_a_guess(self):
        out = self.match(1, [self.person("short")])
        self.assertEqual(out["classification"], "member_a")
        self.assertFalse(out["confirmed"])
        self.assertEqual(out["uncertainty"], "high")

    def test_unknown_without_evidence(self):
        self.assertEqual(self.match(1, [self.person()])["classification"], "unknown")

    def test_ties_are_unknown(self):
        same = {"member_a": {"hair": "short"}, "member_b": {"hair": "short"}}
        self.assertEqual(self.match(1, [self.person("short")], same)["classification"], "unknown")

    def test_unset_profiles_are_unknown(self):
        blank = {"member_a": {"hair": "unknown"}, "member_b": {"hair": "unknown"}}
        self.assertEqual(self.match(1, [self.person("short")], blank)["classification"], "unknown")

    def test_height_ignored_for_one_person(self):
        self.assertEqual(self.match(1, [self.person("unknown", "taller")])["classification"], "unknown")

    def test_both_needs_two_different_matches(self):
        out = self.match(2, [self.person("short", "taller"), self.person("long", "shorter")])
        self.assertEqual(out["classification"], "both")
        self.assertTrue(out["confirmed"])
        self.assertEqual(self.match(2, [self.person("short"), self.person("short")])["classification"], "unknown")


class ClassifyTests(Base):
    def test_person_records_actual_cost(self):
        post = reply(GOOD)
        out = self.run_it(post)
        self.assertIs(out["person_present"], True)
        self.assertEqual((out["cost_usd"], out["cost_source"]), (0.00005, "actual"))
        self.assertEqual(ov.totals(self.cfg, self.now)["today"], 0.00005)
        self.assertEqual(out["width"], 512)

    def test_empty_is_false(self):
        self.assertIs(self.run_it(reply(EMPTY))["person_present"], False)

    def test_estimates_when_cost_missing(self):
        usage = {"prompt_tokens": 1000, "completion_tokens": 100}
        catalog = [{"id": self.cfg["model"], "pricing": {"prompt": "0.000001", "completion": "0.000002"}}]
        out = ov.classify(self.cfg, self.image, "office", "t", now=self.now, post=reply(GOOD, usage), profiles={}, key="k", fetch=lambda: catalog)
        self.assertEqual(out["cost_source"], "estimated")
        self.assertAlmostEqual(out["cost_usd"], 0.0012)

    def assert_failure_is_null(self, out):
        self.assertIsNone(out["person_present"])

    def test_timeout_never_means_absent(self):
        def post(*a):
            raise TimeoutError()
        out = self.run_it(post)
        self.assertEqual(out["status"], "api_error")
        self.assert_failure_is_null(out)

    def test_http_error_never_means_absent(self):
        def post(*a):
            raise urllib.error.HTTPError("u", 500, "x", {}, None)
        self.assert_failure_is_null(self.run_it(post))

    def test_invalid_answer_never_means_absent(self):
        out = self.run_it(reply({"people": 7}))
        self.assertEqual(out["status"], "invalid_response")
        self.assert_failure_is_null(out)

    def test_stale_snapshot_is_camera_error(self):
        out = self.run_it(reply(GOOD), now=self.now + 500)
        self.assertEqual(out["status"], "camera_error")
        self.assert_failure_is_null(out)

    def test_backoff_grows_then_recovers(self):
        def post(*a):
            raise TimeoutError()
        self.assertEqual(self.run_it(post)["status"], "api_error")
        self.assertEqual(self.run_it(post, now=self.now + 5)["status"], "backoff")
        self.assertEqual([ov.backoff_wait(n, self.cfg) for n in (0, 1, 2, 3, 99)], [0, 30, 60, 120, 600])
        os.utime(self.image, (self.now + 31, self.now + 31))
        self.assertEqual(self.run_it(reply(GOOD), now=self.now + 31)["status"], "ok")
        self.assertEqual(ov.totals(self.cfg, self.now + 31)["failures"], 0)

    def test_budget_stops_calls(self):
        cfg = ov.merge(self.cfg, {"cost": {"daily_limit_usd": 0.00001}, "change_detection": {"enabled": False}})
        post = reply(GOOD)
        self.run_it(post, cfg=cfg)
        os.utime(self.image, (self.now + 1, self.now + 1))
        out = self.run_it(post, now=self.now + 1, cfg=cfg)
        self.assertEqual(out["status"], "budget_exhausted")
        self.assert_failure_is_null(out)
        self.assertEqual(len(post.bodies), 1)

    def test_unchanged_scene_reuses_at_no_cost(self):
        post = reply(GOOD)
        self.run_it(post)
        os.utime(self.image, (self.now + 30, self.now + 30))
        out = self.run_it(post, now=self.now + 30)
        self.assertEqual((out["status"], out["cost_usd"], out["reused"]), ("reused", 0.0, True))
        self.assertEqual(len(post.bodies), 1)

    def test_similarity_alone_never_extends_presence(self):
        post = reply(GOOD)
        self.run_it(post)
        os.utime(self.image, (self.now + 61, self.now + 61))
        self.assertEqual(self.run_it(post, now=self.now + 61)["status"], "ok")
        self.assertEqual(len(post.bodies), 2)

    def test_changed_scene_calls_again(self):
        post = reply(GOOD)
        self.run_it(post)
        self.frame((200, 200, 200))
        os.utime(self.image, (self.now + 30, self.now + 30))
        self.assertEqual(self.run_it(post, now=self.now + 30)["status"], "ok")

    def test_overlap_returns_busy(self):
        import fcntl
        ov.Store(self.cfg["db_path"])
        held = open(self.cfg["db_path"] + ".lock", "w")
        fcntl.flock(held, fcntl.LOCK_EX)
        post = reply(GOOD)
        out = self.run_it(post)
        held.close()
        self.assertEqual(out["status"], "busy")
        self.assert_failure_is_null(out)
        self.assertEqual(post.bodies, [])

    def test_request_is_private_and_strict(self):
        post = reply(GOOD)
        self.run_it(post)
        body = post.bodies[0]
        self.assertEqual(body["provider"]["data_collection"], "deny")
        self.assertTrue(body["response_format"]["json_schema"]["strict"])
        self.assertTrue(body["provider"]["require_parameters"])
        self.assertNotIn("temperature", body)  # with require_parameters, it leaves no usable endpoint


class TotalsTests(Base):
    def test_periods(self):
        store = ov.Store(self.cfg["db_path"])
        import datetime as dt
        wed = dt.datetime(2026, 11, 11, 12).timestamp()
        for offset_days, cost in ((0, 1.0), (-1, 2.0), (-6, 4.0), (-20, 8.0), (-40, 16.0)):
            store.record(ts=wed + offset_days * 86400, camera="c", model="m", status="ok", cost_usd=cost)
        out = ov.totals(self.cfg, wed)
        self.assertEqual((out["today"], out["week"], out["month"]), (1.0, 3.0, 7.0))

    def test_empty_database(self):
        out = ov.totals(self.cfg)
        self.assertEqual(out["today"], 0)
        self.assertIsNone(out["last_cost"])


class BenchmarkTests(unittest.TestCase):
    def test_score(self):
        rows = [
            {"pred": {"people": 0, "dog": False}, "label": {"people": 0, "dog": False, "member": "none"}, "member": {"classification": "none"}, "cost_usd": 1.0, "duration_ms": 10},
            {"pred": {"people": 1, "dog": True}, "label": {"people": 0, "dog": False, "member": "none"}, "member": {"classification": "unknown"}, "cost_usd": 3.0, "duration_ms": 30},
            {"pred": {"people": 0, "dog": False}, "label": {"people": 1, "dog": True, "member": "member_a"}, "member": {"classification": "none"}},
            {"pred": None, "label": {"people": 1}},
        ]
        out = benchmark.score(rows)
        self.assertEqual(out["failed"], 1)
        self.assertEqual(out["people_accuracy"], 0.333)
        self.assertEqual(out["person_false_positive_rate"], 0.5)
        self.assertEqual(out["person_false_negative_rate"], 1.0)
        self.assertEqual(out["dog_false_negative_rate"], 1.0)
        self.assertEqual(out["avg_cost_usd"], 2.0)


if __name__ == "__main__":
    unittest.main()
