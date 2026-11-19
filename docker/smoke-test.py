"""Exercise a Countertop image on a fresh Linux Docker bind mount."""

import json
import os
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
import time
from urllib.error import URLError
from urllib.request import Request, urlopen
import sys


def docker(*args):
    return subprocess.check_output(["docker", *args], text=True).strip()


def request(base, path, payload=None):
    req = Request(base + path)
    if payload is not None:
        req.data = json.dumps(payload).encode()
        req.add_header("Content-Type", "application/json")
    with urlopen(req, timeout=3) as response:
        assert response.status == 200, (path, response.status)
        return response.read()


def json_request(base, path, payload=None):
    return json.loads(request(base, path, payload))


def start(image, directory):
    user = f"{os.getuid()}:{os.getgid()}"
    return docker(
        "run", "--detach", "--user", user,
        "--env", "TZ=America/New_York",
        "--publish", "127.0.0.1::8090",
        "--mount", f"type=bind,source={directory},target=/app/work",
        image,
    )


def ready(container):
    base = "http://" + docker("port", container, "8090/tcp")
    deadline = time.monotonic() + 30
    while True:
        try:
            assert isinstance(json_request(base, "/version")["v"], int)
            return base
        except (URLError, TimeoutError):
            if time.monotonic() >= deadline:
                raise
            time.sleep(0.25)


def check_calendar(container):
    docker("exec", container, "python", "-c", """
from datetime import datetime
from tools.countertop import _local_naive

cases = [
    ('20260308T063000Z', datetime(2026, 3, 8, 1, 30)),
    ('20260308T073000Z', datetime(2026, 3, 8, 3, 30)),
    ('20261101T053000Z', datetime(2026, 11, 1, 1, 30)),
    ('20261101T063000Z', datetime(2026, 11, 1, 1, 30)),
]
for timestamp, expected in cases:
    actual, all_day = _local_naive(timestamp, '')
    assert actual == expected and not all_day, (timestamp, actual, expected)
assert _local_naive('20260115T090000', 'DTSTART;TZID=America/Los_Angeles')[0] == datetime(2026, 1, 15, 12)
""")


def smoke(image, directory):
    container = start(image, directory)
    try:
        base = ready(container)
        for path in ("/dash", "/control", "/list"):
            assert request(base, path), path
        assert json_request(base, "/notes")["items"] == []

        items = json_request(base, "/notes", {"op": "add", "text": "Smoke test apples"})["items"]
        item = items[0]
        assert item["text"] == "Smoke test apples" and not item["done"]
        json_request(base, "/notes", {"op": "toggle", "id": item["id"]})

        config = {"modules": {"general": {"settings": {"place": "Smoke test"}}}}
        json_request(base, "/config", config)
        calendar = {"name": "Smoke calendar", "url": "https://example.invalid/private.ics"}
        json_request(base, "/sources", {"kind": "calendars", "op": "add", "item": calendar})
        assert (Path(directory) / "sources.json").stat().st_mode & 0o777 == 0o600
        check_calendar(container)

        docker("rm", "--force", "--volumes", container)
        container = start(image, directory)
        base = ready(container)
        assert json_request(base, "/notes")["items"] == [dict(item, done=True)]
        assert json_request(base, "/config")["modules"]["general"]["settings"]["place"] == "Smoke test"
        saved = json_request(base, "/sources")["sources"]["calendars"][0]
        assert saved["name"] == calendar["name"] and saved["urlSet"] and "url" not in saved
        assert json.loads((Path(directory) / "sources.json").read_text())["calendars"][0]["url"] == calendar["url"]
    except Exception:
        subprocess.run(["docker", "logs", container], check=False)
        raise
    finally:
        subprocess.run(["docker", "rm", "--force", "--volumes", container], check=False, stdout=subprocess.DEVNULL)
    print(f"{image}: fresh boot, calendar timezone, writes, and persistence passed.")


if __name__ == "__main__":
    if len(sys.argv) != 2 or os.getuid() == 0:
        sys.exit("Usage (as a non-root Linux user with Docker access): python3 docker/smoke-test.py IMAGE")
    with TemporaryDirectory(prefix="countertop-smoke-") as directory:
        smoke(sys.argv[1], directory)
