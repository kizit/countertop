"""The HTTP handler (every route) and main(), which starts the server."""
import argparse
import base64
import json
import platform
import re
import ssl
import sys
import threading
import time
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse
from urllib.request import Request, urlopen
from server import bench, mytiles, sandbox, tiledata, tilefetch, tilekeys
from server.core import VERSION


class Handler(BaseHTTPRequestHandler):
    server_version = "Countertop/" + VERSION

    def _send(self, code, body=b"", ctype="text/plain", extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        if "Cache-Control" not in (extra or {}):
            self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _dash_name(self):
        return config_load()["modules"]["general"]["settings"].get("name")

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj).encode(), "application/json")

    def _read_json(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b"{}"
        try:
            return json.loads(raw.decode("utf-8", "replace"))
        except Exception:
            return {"raw": raw[:4000].decode("utf-8", "replace")}

    def _immich_image(self, sid, asset):
        """One photo from an Immich album set up in Sources: this server holds the API key, and only
        assets that are in the album are served. The screen gets plain image links, nothing else."""
        src = next((a for a in (sources_load().get("albums") or [])
                    if a.get("id") == sid and (a.get("kind") or "") == "Immich"), None)
        cache = PHOTO_CACHES.get("immich:" + sid) or {}
        if not src or asset not in (cache.get("assets") or set()):
            return self._send(404, b"not found")
        try:
            req = Request(src["server"].rstrip("/") + "/api/assets/%s/thumbnail?size=preview" % asset,
                          headers={"x-api-key": src.get("apiKey") or "", "Accept": "image/*"})
            with urlopen(req, timeout=25) as r:
                self._send(200, r.read(30_000_000), r.headers.get("Content-Type", "image/jpeg"),
                           {"Cache-Control": "public, max-age=86400"})
        except Exception:
            self._send(404, b"not found")

    def do_GET(self):
        p = self.path.split("?")[0]
        if p in ("/", "/index.html"):
            self._send(302, extra={"Location": "/dash"})
        elif p == "/events":
            self._events()
        elif p == "/sample.ics":
            self._send(200, SAMPLE_ICS.encode(), "text/calendar")
        elif p == "/dash":
            # shell page: owns fullscreen + keep-alive, hosts the dashboard in an iframe
            self._send(200, named((HERE / "shell.html").read_bytes(), self._dash_name()), "text/html; charset=utf-8")
        elif p in ("/dash/content", "/dashboard"):
            self._send(200, named(page("dash"), self._dash_name()), "text/html; charset=utf-8")
        elif p == "/config":
            cfg = config_load()
            tid = parse_qs(urlparse(self.path).query).get("trial", [""])[0]
            if tid:
                trial_apply(cfg, tid)          # a live preview in the Library
            elif self.path == "/config":
                live = trial_screen()          # "Try it on the screen" from the Library
                if live:
                    trial_apply(cfg, live["id"])
                    cfg["trial"] = {"name": live["name"], "left": max(1, int(live["until"] - time.time()))}
            if self.path == "/config?starters=1":
                defaults = migrate_v3({})
                main = next(p for p in defaults["pages"]["settings"]["items"] if p["id"] == "main")
                cfg["everyday"] = {"page": main, "tiles": defaults["tiles"]["settings"]["items"]}
            cfg["schema"] = SCHEMA
            cfg["sources"] = sources_public()
            cfg["sandbox"] = sandbox.sandbox_view(parse_qs(urlparse(self.path).query).get("draft", [""])[0])
            # Your own tiles still on the dashboard, and why each wasn't converted (server/mytiles.py)
            cfg["legacy"] = mytiles.legacy_view(((cfg["modules"].get("tiles") or {}).get("settings") or {}).get("items"))
            self._json(cfg)
        elif p.startswith("/studio/tile/"):
            t = mytiles.studio_view(p[len("/studio/tile/"):])
            self._json(t, 200) if t else self._json({"error": "No such tile"}, 404)
        elif p == "/community":
            self._json(community_index(bool(parse_qs(urlparse(self.path).query).get("refresh"))))     # the gallery's list, when Controls opens Community
        elif p == "/community/shot":
            # a gallery tile's screenshot, read from the gallery by the server (the screen and Controls never call out)
            try:
                got = commtiles.gallery_shot(parse_qs(urlparse(self.path).query).get("id", [""])[0], community_index(), gallery_url())
            except Exception:
                got = None
            if got:
                self._send(200, got[0], got[1], {"Cache-Control": "max-age=86400", "X-Content-Type-Options": "nosniff"})
            else:
                self._send(404, b"no picture")
        elif p == "/sources":
            self._json({"sources": sources_public(), "kinds": SOURCE_KINDS})
        elif p == "/control":
            self._send(200, page("control"), "text/html; charset=utf-8")
        elif p == "/team":
            self._json(team_matches(parse_qs(urlparse(self.path).query).get("id", [""])[0]))
        elif p == "/photos":
            self._json(album_photos(parse_qs(urlparse(self.path).query).get("id", [""])[0]))
        elif re.fullmatch(r"/photos/immich/[\w-]+/[\w-]+\.jpg", p):
            self._immich_image(p.split("/")[-2], p.rsplit("/", 1)[-1][:-4])
        elif p == "/tiles.js":
            # every tile type is one file in tools/tiles; adding a file adds a tile, no build step
            parts = []
            for f in sorted((HERE / "tiles").glob("*.js")):
                parts.append("/* ---- tiles/%s ---- */\n%s" % (f.name, f.read_text()))
            self._send(200, "\n".join(parts).encode(), "application/javascript")
        elif p == "/radar":
            self._json(radar_frames())
        elif p == "/space":
            self._json(space_picture())
        elif p == "/iss":
            self._json(iss_now())
        elif p == "/planes":
            self._json(planes_near(parse_qs(urlparse(self.path).query).get("r", ["15"])[0]))
        elif p == "/tile-fetch":
            self._tile_fetch()
        elif re.fullmatch(r"/tile-frame/[a-z][a-z0-9-]{1,39}", p):
            code, body, headers = sandbox.tile_frame_page(p.split("/")[2], self.headers.get("Host") or "")
            self._send(code, body, "text/html; charset=utf-8", headers)
        elif re.fullmatch(r"/tile-frame/[a-z][a-z0-9-]{1,39}/runtime\.js", p):
            code, body = sandbox.tile_frame_runtime(p.split("/")[2])
            self._send(code, body, "application/javascript; charset=utf-8", {"X-Content-Type-Options": "nosniff"})
        elif re.fullmatch(r"/tile-frame/[a-z][a-z0-9-]{1,39}/tile\.js", p):
            code, body = sandbox.tile_frame_code(p.split("/")[2])
            self._send(code, body, "application/javascript; charset=utf-8", {"X-Content-Type-Options": "nosniff"})
        elif p == "/meals":
            q = parse_qs(urlparse(self.path).query)
            self._json(meal_ideas(q.get("meal", ["dinner"])[0], q.get("diet", ["Anything"])[0], q.get("src", [""])[0]))
        elif p == "/cams":
            ids = [x for x in parse_qs(urlparse(self.path).query).get("ids", [""])[0].split(",") if x]
            self._json(live_cams(ids))
        elif p == "/sales":
            q = parse_qs(urlparse(self.path).query)
            if q.get("q"):      # debug: the raw ad search for one word, e.g. /sales?q=ghost
                try:
                    self._json(_flipp(q["q"][0], config_load()["modules"]["deals"]["settings"].get("zip") or ""))
                except Exception as e:
                    self._json({"error": str(e)[:300]})
            elif q.get("library"):
                self._json(purchases_library())
            else:
                self._json(sales_view())
        elif p == "/bench":
            self._send(200, bench.index_page(), "text/html; charset=utf-8")
        elif p == "/bench/frame":
            body, headers = bench.frame_page()
            self._send(200, body, "text/html; charset=utf-8", headers)
        elif p == "/bench/hit":
            q = parse_qs(urlparse(self.path).query)
            via = (q.get("via") or [""])[0]
            bench.hit(via, (q.get("run") or [""])[0], self.client_address[0])
            if via == "nav":
                self._send(200, b"<!doctype html><title>bench</title>navigated", "text/html; charset=utf-8")
            else:
                self._send(200, b"GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;", "image/gif")
        elif p == "/bench/results":
            self._json(bench.results())
        elif p == "/version":
            # the shell polls this and reloads the iframe when the dashboard page, a tile file, the settings or Setup change
            self._json({"v": dash_version(), "orientation": dashboard_orientation()})
        elif p == "/status":
            if parse_qs(urlparse(self.path).query).get("check"):
                update_check(force=True)
            self._json(status_view())
        elif p == "/diagnostics":
            name = "countertop-diagnostics-%s.zip" % time.strftime("%Y%m%d-%H%M")
            self._send(200, diagnostics_zip(), "application/zip", {"Content-Disposition": 'attachment; filename="%s"' % name})
        elif p == "/ha/states":
            q = parse_qs(urlparse(self.path).query)
            self._json(ha_view(q.get("src", [""])[0], q.get("ids", [""])[0].split(",")))
        elif p == "/ha/entities":
            self._json(ha_entities(parse_qs(urlparse(self.path).query).get("src", [""])[0]))
        elif p == "/tile-data":
            q = parse_qs(urlparse(self.path).query)
            try:
                since = int((q.get("since") or ["0"])[0])
            except ValueError:
                since = 0
            self._json(tiledata.changed(since, live_tiles()))
        elif p == "/notes":
            q = parse_qs(urlparse(self.path).query)
            lid = (q.get("list") or [""])[0].strip()
            if lid and local_list_source(lid):
                self._json(local_list_view(lid))
            else:
                self._json(notes_view())
        elif p == "/list":
            self._send(200, named((HERE / "list.html").read_bytes(), self._dash_name()), "text/html; charset=utf-8")
        elif re.fullmatch(r"/starters/[a-z]+\.jpg", p) and (HERE / p[1:]).is_file():
            self._send(200, (HERE / p[1:]).read_bytes(), "image/jpeg")
        elif p == "/keep.js":
            self._send(200, (HERE / "keep.js").read_bytes(), "application/javascript")
        elif p == "/media.mp3":
            self._send(200, (HERE / "media.mp3").read_bytes(), "audio/mpeg")
        elif p == "/favicon.ico":
            self._send(204)
        elif re.fullmatch(r"/lang/[a-z]{2}\.json", p) and (HERE / "lang" / p[6:]).is_file():
            # words for the Language setting: English text → translation (tools/lang/, docs/languages.md)
            self._send(200, (HERE / "lang" / p[6:]).read_bytes(), "application/json; charset=utf-8")
        elif p.startswith("/fonts/") and re.fullmatch(r"/fonts/[A-Za-z0-9_-]+\.woff2", p) and (HERE / "fonts" / p[7:]).is_file():
            self._send(200, (HERE / "fonts" / p[7:]).read_bytes(), "font/woff2", {"Cache-Control": "max-age=2592000"})
        else:
            self._send(204)

    def do_POST(self):
        p = self.path.split("?")[0]
        if self.headers.get("Origin") == "null":       # a sandboxed tile frame: it may not post anything here
            return self._send(403, b"forbidden")
        body = self._read_json()
        if p == "/report":
            body["t"] = time.strftime("%H:%M:%S")
            body["client"] = self.client_address[0]
            body["kind"] = "report"
            log_entry(body)
            if body.get("task") == "beat":
                SCREEN["beat"], SCREEN["at"] = body.get("result") or {}, time.time()
            elif body.get("task") == "js-error":
                SCREEN["errors"].append({"at": time.time(), "error": str(body.get("error") or "")[:300]})
            self._send(204)
        elif p == "/sandbox/beat":
            try:
                self._json(sandbox.sandbox_beat(body, self.client_address[0], dash_version()))
            except ValueError as e:
                self._json({"error": str(e)}, 400)
        elif p == "/tile-key":
            # an API key for a community tile, typed in its settings: saved on the server, never sent back
            t = sandbox.community_tile(str(body.get("type") or ""))
            try:
                if not t or t.get("draft"):
                    raise ValueError("No such community tile")
                self._json({"keys": tilekeys.save_key(t, str(body.get("name") or ""), None if body.get("remove") is True else body.get("value"))})
            except ValueError as e:
                self._json({"error": str(e)}, 400)
        elif p == "/community/tile":
            # Download or Update a gallery tile: read from the gallery here, never taken from the browser
            try:
                self._json(commtiles.install(body.get("id"), body.get("consent"), community_index(True)))
            except PermissionError as e:
                self._json({"error": str(e), "perms": getattr(e, "perms", []), "ask": True}, 409)
            except ValueError as e:
                self._json({"error": str(e)}, 400)
        elif p == "/community/tile/remove":
            try:
                self._json(commtiles.remove(body.get("type")))
            except ValueError as e:
                self._json({"error": str(e)}, 400)
        elif p.startswith("/studio/"):
            self._studio(p[len("/studio/"):], body)
        elif p == "/sandbox/safe":
            sandbox.set_safe_mode(body.get("on") is True, "person")
            self._json({"safe": sandbox.safe_mode()["on"]})
        elif p == "/bench/save":
            try:
                self._json(bench.save(body))
            except ValueError as e:
                self._json({"error": str(e)}, 400)
        elif p == "/config":
            try:
                self._json(config_save(body))
            except Exception as e:
                self._json({"error": str(e)}, 400)
        elif p == "/trial":
            try:
                self._json(trial_add(body))
            except Exception as e:
                self._json({"error": str(e)}, 400)
        elif p == "/trial/stop":
            trial_stop()
            self._json({"ok": True})
        elif p == "/sources":
            try:
                self._json({"sources": sources_apply(body), "kinds": SOURCE_KINDS})
            except Exception as e:
                self._json({"error": str(e)}, 400)
        elif p.startswith("/tile-data/"):
            try:
                self._json(tiledata.apply(p[len("/tile-data/"):], body, live_tiles()))
            except tiledata.TileDataError as e:
                self._json({"error": str(e)}, e.code)
        elif p.startswith("/tile-trust/"):
            ok = tile_trust(unquote(p[len("/tile-trust/"):]))
            self._json({"ok": ok}, 200 if ok else 404)
        elif p.startswith("/tile-act/"):
            code, out = tile_act(p[len("/tile-act/"):], body)
            self._json(out, code)
        elif p == "/sources/test":
            self._json(recipes_test(body.get("item") or {}) if body.get("kind") == "recipes" else ha_test(body))
        elif p == "/lists/push":
            code, out = list_push(body)
            self._json(out, code)
        elif p == "/notes":
            lid = str(body.get("list") or "").strip()
            if lid and local_list_source(lid):
                self._json(local_list_apply(lid, body))
            elif pushed_list() and body.get("op") in ("add", "toggle", "remove", "clear_done"):
                self._json(notes_view())          # the list is kept in another app: read-only here
            elif reminders_list_name() and body.get("op") in ("add", "toggle", "remove", "clear_done"):
                self._json(reminders_apply(body))
            else:
                notes_apply(body)
                self._json(notes_view())
        else:
            self._send(404)

    def _studio(self, what, body):
        """Tile Studio (server/mytiles.py): save, preview drafts, delete, import, run, convert and restore."""
        try:
            if what == "save":
                out = mytiles.save(body)
            elif what == "draft":
                out = {"id": sandbox.draft_put(body.get("tile"), body.get("of") or "")}
            elif what == "delete":
                out = mytiles.delete(body.get("id"))
            elif what == "import":
                out = mytiles.import_tile(body)
            elif what == "trust":
                out = mytiles.trust(body.get("id"))
            elif what == "convert":
                out = tile_convert(str(body.get("id") or ""))
            elif what == "restore":
                out = tile_restore(str(body.get("id") or ""))
            elif what == "check":
                out = mytiles.precheck(body.get("html"))
            else:
                return self._send(404)
        except ValueError as e:
            return self._json({"error": str(e)}, 400)
        self._json(out)

    def _tile_fetch(self):
        """A web address read for a tile: only on the sites that kind of tile declared (tools/server/tilefetch.py)."""
        q = parse_qs(urlparse(self.path).query)
        typ, url = (q.get("type") or [""])[0], (q.get("url") or [""])[0]
        hosts = sandbox.tile_hosts(typ) if re.fullmatch(r"[a-z][a-z0-9-]{1,39}", typ) else None
        # the answer is someone else's text: if a frame is ever pointed here, it is shown as inert text
        inert = {"Content-Security-Policy": "sandbox; default-src 'none'", "X-Content-Type-Options": "nosniff"}
        if not hosts:
            return self._send(403, json.dumps({"error": "This tile can't reach the internet."}).encode(), "application/json", inert)
        try:
            # a community tile's API keys are added by the server, only for the one site each is for (tilekeys.py)
            image = (q.get("as") or [""])[0] == "image"
            res = tilefetch.cached_fetch(url, hosts, (q.get("maxAge") or ["300"])[0], tilekeys.fetch_keys(sandbox.keys_tile(sandbox.community_tile(typ))), typ, image)
        except tilefetch.FetchError as e:
            return self._send(e.code, json.dumps({"error": str(e)}).encode(), "application/json", inert)
        if image:
            # a picture for a tile's frame, which can only show data: addresses
            return self._send(200, json.dumps({"data": "data:%s;base64,%s" % (res["type"], base64.b64encode(res["body"]).decode())}).encode(),
                              "application/json", inert)
        ctype = "application/json" if "json" in res["type"] else "text/plain; charset=utf-8"
        self._send(200, res["body"], ctype, inert)

    def _events(self):
        qs = parse_qs(urlparse(self.path).query)
        # calendars come from Setup > Sources; ?cal=id1,id2 limits to some of them (default: all)
        want = [c for c in (qs.get("cal", [""])[0] or "").split(",") if c]
        cals = [c for c in sources_load().get("calendars", []) if c.get("url") and (not want or c.get("id") in want)]
        if qs.get("url", [""])[0]:
            cals = [{"id": "test", "name": "Test", "url": qs["url"][0]}]
        for c in cals:
            u = c["url"].strip()
            c["_u"] = "https://" + u[len("webcal://"):] if u.startswith("webcal://") else u
        cals = [c for c in cals if c["_u"].startswith(("http://", "https://"))]
        urls = [c["_u"] for c in cals]
        if not urls:
            self._json({"events": [], "error": "no calendar configured"}, 200)
            return

        now = time.time()
        merged, errors = [], []
        for cal in cals:
            url = cal["_u"]
            tag = lambda evs: [dict(e, cal=cal.get("id"), color=cal.get("color") or "") for e in evs]
            cached = ICS_CACHE.get(url)
            if cached and now - cached[0] < 300:
                merged.extend(tag(cached[1]))
                continue
            try:
                req = Request(url, headers={"User-Agent": "Mozilla/5.0 Countertop/1.0"})
                raw = urlopen(req, timeout=15).read(3_000_000).decode("utf-8", "replace")
                evs = parse_ics(raw)
                ICS_CACHE[url] = (now, evs)
                try:                                     # last copy kept on this machine only, for troubleshooting
                    cf = WORK / ("calendar_cache_%s.ics" % re.sub(r"[^A-Za-z0-9_-]", "", str(cal.get("id")))[:20])
                    cf.write_text(raw)
                    cf.chmod(0o600)
                except Exception:
                    pass
                merged.extend(tag(evs))
                CAL_STATUS[cal.get("id")] = {"name": cal.get("name") or "Calendar", "at": now, "ok": True, "error": "", "count": len(evs)}
            except Exception as e:
                msg = str(e).replace(url, "(link)")[:120]           # never echo the link: it is the password
                errors.append("%s: %s" % (cal.get("name") or "Calendar", msg))
                last = CAL_STATUS.get(cal.get("id")) or {}
                CAL_STATUS[cal.get("id")] = dict(last, name=cal.get("name") or "Calendar", ok=False, error=msg, tried=now)
        merged.sort(key=lambda e: e["start"])
        seen, deduped = set(), []
        for e in merged:
            k = (e["summary"], e["start"], e.get("cal"))
            if k in seen:
                continue
            seen.add(k)
            deduped.append(e)
        if "month" not in qs:
            # default view (the classic dashboard): from an hour ago through the next 30 days
            lo = (datetime.now() - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%S")
            today = datetime.now().strftime("%Y-%m-%d")
            hi = (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d")
            deduped = [e for e in deduped if (e["start"] >= today if e["allDay"] else e["start"] >= lo) and e["start"] <= hi][:40]
        self._json({"events": deduped, "errors": errors})

    def log_message(self, *a):
        pass


def dash_version():
    """Changes whenever the screen should load the dashboard again: its page or a tile file changed, the settings or
    Setup changed, the server restarted (the dashboard reads /config when it starts), a layout tried on the screen
    started or ended, or a community tile or safe mode changed."""
    v = 0
    for f in page_files("dash") + [CONFIG_FILE, SOURCES_FILE] + sorted((HERE / "tiles").glob("*.js")):
        try:
            v = max(v, int(f.stat().st_mtime))
        except OSError:
            pass
    return v + SERVER_START + trial_version() + sandbox.sandbox_version()


def main():
    ap = argparse.ArgumentParser(description="Countertop dashboard server")
    ap.add_argument("--port", type=int, default=8090)
    ap.add_argument("--tls", action="store_true")
    ap.add_argument("--cert", default=str(WORK / "tls" / "cert.pem"))
    ap.add_argument("--key", default=str(WORK / "tls" / "key.pem"))
    ap.add_argument("--also-tls", action="store_true", help="also listen HTTPS on --tls-port sharing state")
    ap.add_argument("--tls-port", type=int, default=8443)
    a = ap.parse_args()
    WORK.mkdir(parents=True, exist_ok=True)
    sys.stdout, sys.stderr = _Tee(sys.stdout), _Tee(sys.stderr)
    print("Countertop %s starting (Python %s, %s)" % (VERSION, platform.python_version(), platform.system()), flush=True)
    if OLD_LOG.exists() and not LOG.exists():
        try:
            OLD_LOG.rename(LOG)
        except OSError:
            pass
    threading.Thread(target=reminders_loop, daemon=True).start()
    threading.Thread(target=update_loop, daemon=True).start()
    threading.Thread(target=sandbox.safe_loop, daemon=True).start()
    threading.Thread(target=commtiles.takedown_loop, args=(community_index,), daemon=True).start()
    ip = lan_ip()
    scheme = "https" if a.tls else "http"
    srv = ThreadingHTTPServer(("0.0.0.0", a.port), Handler)
    if a.tls:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(a.cert, a.key)
        srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
    if a.also_tls and not (Path(a.cert).exists() and Path(a.key).exists()):
        print("HTTPS not started: no certificate at %s (only needed for older Echo setups)" % a.cert, flush=True)
        a.also_tls = False
    if a.also_tls:
        tls_srv = ThreadingHTTPServer(("0.0.0.0", a.tls_port), Handler)
        ctx2 = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx2.load_cert_chain(a.cert, a.key)
        tls_srv.socket = ctx2.wrap_socket(tls_srv.socket, server_side=True)
        threading.Thread(target=tls_srv.serve_forever, daemon=True).start()
        print("dashboard (TLS): https://%s:%d/dash" % (ip, a.tls_port))
    print("dashboard    : %s://%s:%d/dash" % (scheme, ip, a.port))
    print("controls     : %s://%s:%d/control" % (scheme, ip, a.port))
    print("heartbeat log: %s" % LOG, flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


# names used only inside functions: imported last, so these modules can use each other
from server.actions import tile_act  # noqa: E402
from server.config import CONFIG_FILE, SCHEMA, SERVER_START, config_load, config_save, dashboard_orientation, live_tiles, tile_convert, tile_restore, tile_trust  # noqa: E402
from server.core import CAL_STATUS, HERE, ICS_CACHE, LOG, OLD_LOG, SCREEN, WORK, _Tee, lan_ip, log_entry  # noqa: E402
from server.feeds.calendar import SAMPLE_ICS, parse_ics  # noqa: E402
from server.feeds.cams import live_cams  # noqa: E402
from server.feeds.meals import meal_ideas, recipes_test  # noqa: E402
from server.feeds.photos import PHOTO_CACHES, album_photos  # noqa: E402
from server.feeds.sales import _flipp, purchases_library, sales_view  # noqa: E402
from server.feeds.sky import iss_now, planes_near, radar_frames, space_picture  # noqa: E402
from server.feeds.sports import team_matches  # noqa: E402
from server.homeassistant import ha_entities, ha_test, ha_view  # noqa: E402
from server import controls  # noqa: E402,F401  (adds the tile.control action)
from server.pages import named, page, page_files  # noqa: E402
from server.community import community_index, gallery_url  # noqa: E402
from server import commtiles  # noqa: E402
from server.library import trial_add, trial_apply, trial_screen, trial_stop, trial_version  # noqa: E402
from server.lists import list_push, local_list_apply, local_list_source, local_list_view, notes_apply, notes_view, pushed_list, reminders_apply, reminders_list_name, reminders_loop  # noqa: E402
from server.sources import SOURCES_FILE, SOURCE_KINDS, sources_apply, sources_load, sources_public  # noqa: E402
from server.status import diagnostics_zip, status_view, update_check, update_loop  # noqa: E402
from server.upgrades import migrate_v3  # noqa: E402
