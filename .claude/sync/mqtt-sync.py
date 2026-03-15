#!/usr/bin/env python3
"""MQTT-based agent sync for Major Tom."""

import json
import sys
import time
import yaml
from pathlib import Path

import paho.mqtt.client as mqtt

SCRIPT_DIR = Path(__file__).parent
OUTBOX = SCRIPT_DIR / "outbox"
INBOX = SCRIPT_DIR / "inbox"
ARCHIVE = SCRIPT_DIR / "archive"
SECRETS_FILE = Path("/config/secrets.yaml")

SEND_TOPIC_PREFIX = "agent-sync/major-tom-to-gca"
RECV_TOPIC_PATTERN = "agent-sync/gca-to-major-tom/+"
STATUS_TOPIC = "agent-sync/major-tom/status"


def load_credentials():
    """Load MQTT credentials from secrets.yaml."""
    with open(SECRETS_FILE) as f:
        secrets = yaml.safe_load(f)
    return secrets["mqtt_agent_user"], secrets["mqtt_agent_pass"]


def get_client():
    user, password = load_credentials()
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="major-tom-sync")
    client.username_pw_set(user, password)
    # Try internal HA hostname first, fall back to localhost
    for host in ["192.168.4.158", "core-mosquitto"]:
        try:
            client.connect(host, 1883, keepalive=60)
            return client
        except Exception:
            continue
    raise ConnectionError("Could not connect to MQTT broker")


def send_message(filepath: Path):
    content = filepath.read_text()
    filename = filepath.name
    payload = json.dumps({
        "filename": filename,
        "content": content,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    })
    client = get_client()
    client.loop_start()
    # Each message gets its own subtopic for independent retention
    topic = f"{SEND_TOPIC_PREFIX}/{filename.replace('.md', '')}"
    result = client.publish(topic, payload, retain=True, qos=1)
    result.wait_for_publish(timeout=5)
    client.loop_stop()
    client.disconnect()
    print(f"Sent: {filename}")
    dest = ARCHIVE / filename
    filepath.rename(dest)
    print(f"Archived: {filename}")


def send_all():
    files = list(OUTBOX.glob("*.md"))
    if not files:
        print("Outbox is empty.")
        return
    for f in sorted(files):
        send_message(f)
    print(f"Sent {len(files)} message(s).")


def receive_messages():
    print(f"Checking: {RECV_TOPIC_PATTERN}")
    received = []

    def on_message(client, userdata, msg):
        try:
            payload = json.loads(msg.payload.decode())
            filename = payload.get("filename", f"msg-{int(time.time())}.md")
            content = payload.get("content", msg.payload.decode())
            dest = INBOX / filename
            archived = ARCHIVE / filename
            if not dest.exists() and not archived.exists():
                dest.write_text(content)
                print(f"Received: {filename}")
                received.append(filename)
            else:
                pass  # Already have or already archived, skip silently
        except json.JSONDecodeError:
            filename = f"raw-{int(time.time())}.md"
            dest = INBOX / filename
            dest.write_text(msg.payload.decode())
            print(f"Received raw: {filename}")
            received.append(filename)

    client = get_client()
    client.on_message = on_message
    client.subscribe(RECV_TOPIC_PATTERN)
    client.loop_start()
    time.sleep(5)
    client.loop_stop()
    client.disconnect()
    if not received:
        print("No new messages.")


def check_status():
    user, _ = load_credentials()
    print(f"Connecting as {user}...")
    client = get_client()
    client.loop_start()
    status_msg = f"Major Tom online {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}"
    result = client.publish(STATUS_TOPIC, status_msg, retain=True)
    result.wait_for_publish(timeout=5)
    client.loop_stop()
    client.disconnect()
    print("Connection OK")
    print(f"Published: {status_msg}")


def main():
    INBOX.mkdir(exist_ok=True)
    OUTBOX.mkdir(exist_ok=True)
    ARCHIVE.mkdir(exist_ok=True)

    if len(sys.argv) < 2:
        print("Usage: mqtt-sync.py {send|receive|status}")
        sys.exit(1)

    cmd = sys.argv[1]
    if cmd == "send":
        if len(sys.argv) > 2:
            send_message(Path(sys.argv[2]))
        else:
            send_all()
    elif cmd == "receive":
        receive_messages()
    elif cmd == "status":
        check_status()
    else:
        print(f"Unknown: {cmd}")
        sys.exit(1)


if __name__ == "__main__":
    main()
