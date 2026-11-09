#!/usr/bin/env python3
"""Compare OpenRouter vision models on real camera frames.

  python3 benchmark.py --images DIR --models a/b,c/d [--labels labels.json]
                       [--sizes 512,384,256] [--output results.json]

labels.json maps file name to ground truth, for example:
  {"empty1.jpg": {"people": 0, "dog": false, "member": "none", "condition": "empty room"}}
Without labels it reports only cost, latency and schema success, not accuracy.
Keep real frames out of this repo: it is public.
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import office_vision as ov  # noqa: E402


def rate(hits, total):
    return round(hits / total, 3) if total else None


def score(rows):
    """Accuracy and error rates for rows that have both a prediction and a label."""
    done = [r for r in rows if r.get("pred") and r.get("label")]
    errors = sum(1 for r in rows if not r.get("pred"))
    out = {"images": len(rows), "failed": errors, "labelled": len(done),
           "avg_cost_usd": None, "avg_latency_ms": None, "avg_input_tokens": None}
    for field, name in (("cost_usd", "avg_cost_usd"), ("duration_ms", "avg_latency_ms"), ("input_tokens", "avg_input_tokens")):
        values = [r[field] for r in rows if r.get(field) is not None]
        if values:
            out[name] = sum(values) / len(values)
    people = [r for r in done if "people" in r["label"]]
    out["people_accuracy"] = rate(sum(r["pred"]["people"] == r["label"]["people"] for r in people), len(people))
    empty = [r for r in people if r["label"]["people"] == 0]
    occupied = [r for r in people if r["label"]["people"] > 0]
    out["person_false_positive_rate"] = rate(sum(r["pred"]["people"] > 0 for r in empty), len(empty))
    out["person_false_negative_rate"] = rate(sum(r["pred"]["people"] == 0 for r in occupied), len(occupied))
    dogs = [r for r in done if "dog" in r["label"]]
    out["dog_accuracy"] = rate(sum(r["pred"]["dog"] == r["label"]["dog"] for r in dogs), len(dogs))
    no_dog = [r for r in dogs if not r["label"]["dog"]]
    has_dog = [r for r in dogs if r["label"]["dog"]]
    out["dog_false_positive_rate"] = rate(sum(r["pred"]["dog"] for r in no_dog), len(no_dog))
    out["dog_false_negative_rate"] = rate(sum(not r["pred"]["dog"] for r in has_dog), len(has_dog))
    members = [r for r in done if "member" in r["label"]]
    out["member_accuracy"] = rate(sum(r["member"]["classification"] == r["label"]["member"] for r in members), len(members))
    return out


def run(cfg, images, models, sizes, labels, profiles, key, post=ov.http_post):
    results = []
    store = ov.Store(cfg["db_path"])
    for model in models:
        for size in sizes:
            rows = []
            for name in images:
                jpeg, (width, height) = ov.optimize_image(name, size, cfg["image"]["jpeg_quality"])
                row = {"image": os.path.basename(name), "label": labels.get(os.path.basename(name)), "width": width, "height": height}
                try:
                    obs, usage, duration = ov.call_model(cfg, model, jpeg, key, post)
                    row.update(pred=obs, member=ov.match_household(obs, profiles, cfg["matching"]), duration_ms=duration,
                               input_tokens=usage.get("prompt_tokens"), output_tokens=usage.get("completion_tokens"),
                               cost_usd=ov.resolve_cost(usage, store, model)[0])
                except Exception as err:
                    row.update(pred=None, error=f"{type(err).__name__} {getattr(err, 'code', '')}".strip())
                rows.append(row)
            results.append({"model": model, "max_dimension": size, "summary": score(rows), "rows": rows})
    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--images", required=True)
    parser.add_argument("--models", required=True)
    parser.add_argument("--labels")
    parser.add_argument("--sizes", default="512")
    parser.add_argument("--output", default="/tmp/office_vision_benchmark.json")
    args = parser.parse_args()
    cfg = ov.load_config()
    names = sorted(os.path.join(args.images, f) for f in os.listdir(args.images) if f.lower().endswith((".jpg", ".jpeg", ".png")))
    labels = json.load(open(args.labels)) if args.labels else {}
    results = run(cfg, names, args.models.split(","), [int(s) for s in args.sizes.split(",")], labels, ov.load_profiles(), ov.api_key(cfg))
    with open(args.output, "w") as handle:
        json.dump(results, handle, indent=1)
    for item in results:
        print(item["model"], f"@{item['max_dimension']}px", json.dumps(item["summary"]))
    print("saved", args.output)


if __name__ == "__main__":
    main()
