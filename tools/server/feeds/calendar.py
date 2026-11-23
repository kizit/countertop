"""Calendars: reading iCal feeds, repeating events, and the sample calendar."""
import re
from datetime import datetime, timedelta


# served at /sample.ics; the demo data (demo/work/sources.json) uses it as its calendar
SAMPLE_ICS = """BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
SUMMARY:One-off event\r
DTSTART;TZID=America/Chicago:20261120T100000\r
DTEND;TZID=America/Chicago:20261120T110000\r
END:VEVENT\r
BEGIN:VEVENT\r
SUMMARY:Weekly standup\r
DTSTART;TZID=America/Chicago:20260105T093000\r
DTEND;TZID=America/Chicago:20260105T094500\r
RRULE:FREQ=WEEKLY;BYDAY=MO,WE\r
END:VEVENT\r
BEGIN:VEVENT\r
SUMMARY:All day thing\r
DTSTART;VALUE=DATE:20261124\r
END:VEVENT\r
END:VCALENDAR\r
"""


def _unfold(text):
    return re.sub(r"\r?\n[ \t]", "", text)


def _field(block, name):
    m = re.search(r"^" + name + r"(?:;[^:]*)?:(.*)$", block, re.M)
    return m.group(1).strip() if m else None


def _raw(block, name):
    """Return (params, value) for a property."""
    m = re.search(r"^(" + name + r"(?:;[^:]*)?):(.*)$", block, re.M)
    if not m:
        return None, None
    return m.group(1), m.group(2).strip()


def _parse_dt(val):
    if not val:
        return None, False
    v = val.strip()
    if re.fullmatch(r"\d{8}", v):
        return "%s-%s-%s" % (v[0:4], v[4:6], v[6:8]), True
    m = re.fullmatch(r"(\d{8})T(\d{6})(Z?)", v)
    if m:
        d, t, z = m.groups()
        iso = "%s-%s-%sT%s:%s:%s" % (d[0:4], d[4:6], d[6:8], t[0:2], t[2:4], t[4:6])
        return (iso + "Z" if z else iso), False
    return None, False


def _local_naive(val, params):
    """Parse a DTSTART/EXDATE-style value into a naive datetime in the Mac's local time.
    Handles UTC (Z), TZID=..., floating times and VALUE=DATE."""
    v = (val or "").strip()
    if re.fullmatch(r"\d{8}", v):
        return datetime.strptime(v, "%Y%m%d"), True
    m = re.fullmatch(r"(\d{8}T\d{6})(Z?)", v)
    if not m:
        return None, False
    dt = datetime.strptime(m.group(1), "%Y%m%dT%H%M%S")
    try:
        from datetime import timezone
        if m.group(2):
            return dt.replace(tzinfo=timezone.utc).astimezone().replace(tzinfo=None), False
        tz = re.search(r"TZID=([^;:]+)", params or "")
        if tz:
            from zoneinfo import ZoneInfo
            return dt.replace(tzinfo=ZoneInfo(tz.group(1).strip('"'))).astimezone().replace(tzinfo=None), False
    except Exception:
        pass
    return dt, False


def _all_raw(block, name):
    return re.findall(r"^(" + name + r"(?:;[^:]*)?):(.*)$", block, re.M)


def _to_dt(iso, all_day):
    if not iso:
        return None
    try:
        if all_day:
            return datetime.strptime(iso, "%Y-%m-%d")
        return datetime.fromisoformat(iso.replace("Z", ""))
    except Exception:
        return None


def _rrule_expand(rule, dtstart, cursor, window_end, limit=400):
    """Small RRULE expander (no dateutil needed): DAILY/WEEKLY/MONTHLY/YEARLY with INTERVAL, COUNT, UNTIL,
    BYDAY (incl. 2TU / -1FR), BYMONTHDAY and BYMONTH. Returns starts within [cursor, window_end]."""
    import calendar
    P = dict(kv.split("=", 1) for kv in rule.split(";") if "=" in kv)
    freq, iv = P.get("FREQ", "").upper(), max(1, int(P.get("INTERVAL", "1") or 1))
    count = int(P["COUNT"]) if P.get("COUNT", "").isdigit() else None
    until = None
    if P.get("UNTIL"):
        u = P["UNTIL"]
        # a UTC end (…Z) is turned into local time, as the dateutil branch of parse_ics does
        until = _local_naive(u[:16], "")[0] if "T" in u else datetime.strptime(u[:8], "%Y%m%d").replace(hour=23, minute=59, second=59)
    days = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]
    byday = [(int(m.group(1) or 0), days.index(m.group(2))) for m in (re.match(r"([+-]?\d*)(MO|TU|WE|TH|FR|SA|SU)$", x.strip().upper()) for x in P.get("BYDAY", "").split(",") if x.strip()) if m]
    bymd = [int(x) for x in P.get("BYMONTHDAY", "").split(",") if x.strip().lstrip("-").isdigit()]
    bymon = [int(x) for x in P.get("BYMONTH", "").split(",") if x.strip().isdigit()] or None
    t = (dtstart.hour, dtstart.minute, dtstart.second)

    def at(d):
        return datetime(d.year, d.month, d.day, *t)

    def month_days(y, m):
        n = calendar.monthrange(y, m)[1]
        out = set()
        for x in bymd:
            if 1 <= abs(x) <= n:
                out.add(x if x > 0 else n + 1 + x)
        for nth, wd in byday:
            ds = [d for d in range(1, n + 1) if datetime(y, m, d).weekday() == wd]
            if nth == 0:
                out.update(ds)
            elif 1 <= abs(nth) <= len(ds):
                out.add(ds[nth - 1] if nth > 0 else ds[nth])
        if not out:
            out.add(dtstart.day) if dtstart.day <= n else None
        return sorted(out)

    def periods():
        if freq == "DAILY":
            d = dtstart
            while True:
                yield [d]
                d += timedelta(days=iv)
        elif freq == "WEEKLY":
            wk = dtstart - timedelta(days=dtstart.weekday())
            wds = sorted({wd for _, wd in byday}) or [dtstart.weekday()]
            while True:
                yield [at(wk + timedelta(days=w)) for w in wds]
                wk += timedelta(weeks=iv)
        elif freq == "MONTHLY":
            y, m = dtstart.year, dtstart.month
            while True:
                yield [datetime(y, m, d, *t) for d in month_days(y, m)]
                m += iv
                y, m = y + (m - 1) // 12, (m - 1) % 12 + 1
        elif freq == "YEARLY":
            y = dtstart.year
            while True:
                out = []
                for m in (bymon or [dtstart.month]):
                    if byday or bymd:
                        out += [datetime(y, m, d, *t) for d in month_days(y, m)]
                    elif dtstart.day <= calendar.monthrange(y, m)[1]:
                        out.append(datetime(y, m, dtstart.day, *t))
                yield sorted(out)
                y += iv
        else:
            yield [dtstart]
            return

    res, n, guard = [], 0, 0
    for group in periods():
        guard += 1
        if guard > 100000:
            break
        for o in group:
            if o < dtstart or (bymon and o.month not in bymon):
                continue
            if (until and o > until) or o > window_end or (count is not None and n >= count):
                return res
            n += 1
            if o >= cursor:
                res.append(o)
                if len(res) >= limit:
                    return res
    return res


def parse_ics(text, horizon_days=45, past_days=35):
    """Parse VEVENTs, expanding RRULE recurrences within the horizon."""
    text = _unfold(text)
    out = []
    now = datetime.now() - timedelta(days=past_days)     # keep recent past too, for the month page
    window_end = datetime.now() + timedelta(days=horizon_days)

    blocks = re.findall(r"BEGIN:VEVENT(.*?)END:VEVENT", text, re.S)
    # (uid, local start) of every instance that has its own override block (moved or cancelled)
    overridden = set()
    for block in blocks:
        params, rid = _raw(block, "RECURRENCE-ID")
        if rid:
            when, _ = _local_naive(rid, params)
            if when:
                overridden.add(((_field(block, "UID") or ""), when))

    for block in blocks:
        if (_field(block, "STATUS") or "").upper() == "CANCELLED":
            continue
        summary = _field(block, "SUMMARY") or "(untitled)"
        summary = summary.replace("\\,", ",").replace("\\n", " ").replace("\\;", ";")
        uid = _field(block, "UID") or ""
        sparams, sval = _raw(block, "DTSTART")
        start_dt, all_day = _local_naive(sval, sparams)
        eparams, evalue = _raw(block, "DTEND")
        end_dt, _ = _local_naive(evalue, eparams)
        if not start_dt:
            continue
        excluded = set()
        for xparams, xval in _all_raw(block, "EXDATE"):
            for part in xval.split(","):
                when, _ = _local_naive(part.strip(), xparams)
                if when:
                    excluded.add(when.date() if all_day else when)
        duration = (end_dt - start_dt) if (start_dt and end_dt) else timedelta(days=1)
        if not end_dt and not all_day:
            duration = timedelta(hours=1)
        if duration.total_seconds() < 0:
            duration = timedelta(hours=1)

        _, rrule_val = _raw(block, "RRULE")
        occurrences = []
        if rrule_val and start_dt:
            try:
                from dateutil.rrule import rrulestr
                # dtstart is naive local time, so UNTIL must be naive too (dateutil rejects a mix)
                def _until(m):
                    u, _ = _local_naive(m.group(1), "")
                    return "UNTIL=" + (u.strftime("%Y%m%d") if len(m.group(1)) == 8 else u.strftime("%Y%m%dT%H%M%S")) if u else m.group(0)
                rrule_val = re.sub(r"UNTIL=([0-9TZ]+)", _until, rrule_val)
                rule = rrulestr("RRULE:" + rrule_val, dtstart=start_dt)
                cursor = max(start_dt, now - duration)
                for occ in rule.xafter(cursor, count=150, inc=True):
                    if occ > window_end:
                        break
                    occurrences.append(occ)
            except Exception:                       # no dateutil (e.g. the Mac's stock python3): use the built-in expander
                try:
                    occurrences = _rrule_expand(rrule_val, start_dt, max(start_dt, now - duration), window_end)
                except Exception:
                    occurrences = [start_dt] if start_dt >= now - duration else []
        else:
            if start_dt and (start_dt + duration) >= now - timedelta(hours=1):
                occurrences = [start_dt]

        if rrule_val:
            occurrences = [o for o in occurrences
                           if (o.date() if all_day else o) not in excluded and (uid, o) not in overridden]
        for occ in occurrences:
            end_occ = occ + duration
            out.append({
                "summary": summary,
                "start": occ.strftime("%Y-%m-%dT%H:%M:%S") if not all_day else occ.strftime("%Y-%m-%d"),
                "end": end_occ.strftime("%Y-%m-%dT%H:%M:%S") if not all_day else None,
                "allDay": all_day,
                "location": _field(block, "LOCATION"),
            })

    out.sort(key=lambda e: e["start"])
    return out[:600]
