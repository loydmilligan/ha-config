# Office vision classifier

Runs inside the Home Assistant container through `shell_command`. No new service.

## How it fits together
- Motion: `binary_sensor.office_camera_motion_detected` (Amcrest event stream).
- Snapshot: `camera.snapshot` writes `/media/office_debug/last.jpg`, outside the public repo.
- `script.office_presence_check` is what the lights automation calls. With `input_boolean.office_vision_enabled` on it hands off to `script.office_vision_check`; off, it runs the original `ai_task` check and the 5-minute recheck.
- `automation.office_vision_poll` is the only polling loop. While lights are on and motion has stopped, it checks at `input_number.office_vision_poll_seconds`.
- `input_select.office_presence_state`: `motion`, `vision_present`, `vision_absent`, `unknown`.
- Spending and results are in `/config/office_vision_usage.db` (gitignored).

## Settings
`config.yaml`: model, image size, change detection, daily limit, backoff.
Dashboard helpers: on/off, poll interval, empty checks before lights off.
`household.yaml` (gitignored, copy from `household.example.yaml`): who looks like what. Identity stays `unknown` until it is filled in.

## Failure and cost behaviour
`person_present` is null for any failure, so it never counts toward "empty".
Daily limit reached: no AI calls until midnight, lights stay as they are, the remote still works, presence shows `unknown`.
Repeated API failures back off 30 s, doubling to 10 min.
An unchanged scene reuses the last answer at no cost, for at most `max_reuse_seconds`. A reused "empty" never counts toward turning the lights off.

## Commands (on the CM4)
    docker exec homeassistant python3 /config/office_vision/office_vision.py report
    docker exec homeassistant sh -c 'cd /config/office_vision && python3 -m unittest discover -s tests'

## Benchmark
Collect frames for each condition (empty, one person, two people, dog only, person and dog, partly out of frame, poor light, sitting still, facing away) in a folder outside `/config`, label them in `labels.json`, then:

    docker exec homeassistant python3 /config/office_vision/benchmark.py --images /media/office_debug/bench --labels /media/office_debug/bench/labels.json --models anthropic/claude-haiku-5.5,qwen/qwen3-vl-8b-instruct --sizes 512,384,256

Label format is in `benchmark.py`. A model is not proven accurate until it has been through this on real frames.
