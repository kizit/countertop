#!/usr/bin/env python3
"""Records the Tile Studio + AI Chat split-screen demo GIF (docs/screenshots/tile-studio.gif).

Runs the real Countertop server with the fictional demo data (demo/work + demo/fixtures/demo-data.js)
alongside a clean simulated AI chat window to demonstrate Step 1 (Copy for chat), Step 2 (Fill in
the form), Point at something (pinning a note), Copy change request, and version switching.

Needs Python 3.9+, Playwright with Chromium, and ffmpeg.
Run: python3 demo/capture-studio-gif.py
"""
import json
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

REPO = Path(__file__).resolve().parent.parent
OUT = Path(os.environ.get("OUT", str(REPO / "docs" / "screenshots")))

PROMPT_ASK = (
    'A "Walk the dog?" tile using weather and air quality. '
    'Big traffic light (green, amber, red), "Good for about N minutes", '
    'a short reason, and a dog size setting.'
)

REPLY_V1 = r'''{
  "name": "Walk the Dog?",
  "description": "A color-coded traffic light showing dog-walking conditions and an estimated walk duration based on temperature, rain probability, air quality and dog size.",
  "size": [12, 8, 6, 4],
  "every": 900,
  "taps": false,
  "feeds": ["wx", "aqi"],
  "hosts": [],
  "settings": {
    "dogSize": {
      "type": "choice",
      "label": "Dog size",
      "choices": ["Small", "Medium", "Large"],
      "default": "Medium"
    }
  }
}
-----CODE-----
Tile("dog-walk", {
  render(el) {
    const wx = this.feed("weather");
    const air = this.feed("air");
    const size = this.s.dogSize || "Medium";

    const profiles = {
      Small: { coldStop: 25, coldCaution: 45, heatCaution: 74, heatStop: 82, airCaution: 40, airStop: 90, duration: 25 },
      Medium: { coldStop: 20, coldCaution: 40, heatCaution: 78, heatStop: 85, airCaution: 50, airStop: 101, duration: 30 },
      Large: { coldStop: 15, coldCaution: 35, heatCaution: 78, heatStop: 85, airCaution: 50, airStop: 101, duration: 30 }
    };
    const p = profiles[size] || profiles.Medium;
    const num = v => typeof v === "number" && Number.isFinite(v) ? v : NaN;
    const rawTemp = num(wx?.current?.temperature_2m);
    const code = num(wx?.current?.weather_code);
    const aqi = num(air);
    const unit = wx?.current_units?.temperature_2m || "°F";
    const celsius = /C/i.test(unit);
    const temp = celsius ? rawTemp * 9 / 5 + 32 : rawTemp;

    const now = new Date();
    const hourStart = new Date(now);
    hourStart.setMinutes(0, 0, 0);
    const start = hourStart.getTime();
    const end = start + 60 * 60 * 1000;
    const hourly = wx?.hourly;
    let rain = NaN;
    if (Array.isArray(hourly?.time)) {
      for (let i = 0; i < hourly.time.length; i++) {
        const time = new Date(hourly.time[i]).getTime();
        const chance = num(hourly.precipitation_probability?.[i]);
        if (time >= start && time <= end && chance >= 0 && chance <= 100) {
          rain = Number.isFinite(rain) ? Math.max(rain, chance) : chance;
        }
      }
      if (!Number.isFinite(rain) && hourly.precipitation_probability?.length) {
        const c0 = num(hourly.precipitation_probability[0]);
        if (c0 >= 0 && c0 <= 100) rain = c0;
      }
    }

    let minutes = p.duration;
    let reason = "Comfortable outside";
    let status = "green";
    function limit(maxMinutes, why) {
      if (maxMinutes < minutes) { minutes = maxMinutes; reason = why; }
    }
    const weatherReady = Number.isFinite(temp);
    const rainReady = Number.isFinite(rain);
    const airReady = Number.isFinite(aqi) && aqi >= 0 && aqi <= 500;

    if (weatherReady) {
      if (temp >= p.heatStop) limit(0, "Too hot");
      else if (temp >= p.heatStop - 4) limit(5, "Hot pavement risk");
      else if (temp >= p.heatCaution) limit(15, "Warm outside");
      if (temp <= p.coldStop) limit(0, "Too cold");
      else if (temp <= p.coldStop + 10) limit(5, "Very cold");
      else if (temp <= p.coldCaution) limit(15, "Chilly outside");
    }
    if ([95, 96, 99].includes(code)) limit(0, "Thunderstorms");
    else if ([56, 57, 66, 67].includes(code)) limit(0, "Freezing rain");
    else if ([65, 75, 82, 86].includes(code)) limit(0, "Heavy precipitation");
    else if (code >= 51 && code <= 86) limit(10, "Wet outside");
    if (rainReady) {
      if (rain >= 85) limit(0, "Rain very likely");
      else if (rain >= 65) limit(10, "Rain likely");
      else if (rain >= 40) limit(15, "Possible rain");
    }
    if (airReady) {
      if (aqi >= p.airStop) limit(0, "Poor air quality");
      else if (aqi >= p.airStop - 20) limit(5, "Poor air quality");
      else if (aqi > p.airCaution) limit(15, "Elevated AQI");
    }

    if (minutes === 0) status = "red";
    else if (!weatherReady || !rainReady || !airReady) {
      status = "unknown"; minutes = null;
      reason = !weatherReady ? "Waiting for weather" : !rainReady ? "Waiting for forecast" : "Waiting for air quality";
    } else if (minutes < p.duration) status = "amber";

    const labels = { green: "Good to go", amber: "Short walk", red: "Skip the walk", unknown: "Checking conditions" };
    const metrics = [
      weatherReady ? Math.round(rawTemp) + (celsius ? "°C" : "°F") : null,
      rainReady ? "Rain " + Math.round(rain) + "%" : null,
      airReady ? "AQI " + Math.round(aqi) : null
    ].filter(Boolean).join(" · ");

    el.innerHTML = `
      <div class="dogwalk dogwalk-${status}">
        <div class="dw-title">Walk the dog?</div>
        <div class="dw-visual">
          <div class="dw-light" role="img" aria-label="${this.esc(labels[status])}">
            <span class="dw-bulb dw-stop"></span>
            <span class="dw-bulb dw-caution"></span>
            <span class="dw-bulb dw-go"></span>
          </div>
          <div class="dw-verdict">${this.esc(labels[status])}</div>
        </div>
        <div class="dw-duration">
          ${minutes === null ? `<strong>—</strong><span>Try again soon</span>` : `<span>Good for about</span><strong>${minutes}</strong><span class="dw-unit"></span>`}
        </div>
        <div class="dw-reason">${this.esc(reason)}</div>
        <div class="dw-metrics">${this.esc(metrics)}</div>
      </div>
    `;
  },
  css: `
    .dogwalk { box-sizing: border-box; width: 100%; height: 100%; min-width: 0; min-height: 0; padding: 4px; container-type: size; display: grid; grid-template-rows: auto minmax(0, 1fr) auto auto auto; justify-items: center; align-items: center; gap: 5px; overflow: hidden; text-align: center; background: transparent; color: var(--fg); --signal: var(--dim); }
    .dogwalk-green { --signal: #40d989; }
    .dogwalk-amber { --signal: #ffc247; }
    .dogwalk-red { --signal: #ff6269; }
    .dw-title { font-size: clamp(18px, 5.5cqw, 36px); font-weight: 650; line-height: 1.1; }
    .dw-visual { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; min-height: 0; gap: 8px; }
    .dw-light { display: flex; flex-shrink: 0; align-items: center; justify-content: center; gap: clamp(5px, 2cqw, 16px); padding: clamp(6px, 2cqw, 16px); border-radius: 999px; background: #181c22; border: 1px solid rgba(128, 128, 128, 0.25); box-shadow: inset 0 3px 8px rgba(0, 0, 0, 0.3); }
    .dw-bulb { display: block; flex-shrink: 0; width: clamp(24px, min(16cqw, 19cqh), 120px); aspect-ratio: 1; border-radius: 50%; border: 2px solid rgba(255, 255, 255, 0.06); box-sizing: border-box; }
    .dw-stop { background: #49292e; }
    .dw-caution { background: #49402b; }
    .dw-go { background: #254235; }
    .dogwalk-red .dw-stop { background: #ff6269; box-shadow: 0 0 20px rgba(255, 98, 105, 0.55); }
    .dogwalk-amber .dw-caution { background: #ffc247; box-shadow: 0 0 20px rgba(255, 194, 71, 0.55); }
    .dogwalk-green .dw-go { background: #40d989; box-shadow: 0 0 20px rgba(64, 217, 137, 0.55); }
    .dw-verdict { color: var(--signal); font-size: clamp(18px, 6cqw, 48px); font-weight: 800; line-height: 1.1; text-transform: uppercase; letter-spacing: 0.035em; }
    .dw-duration { display: flex; align-items: baseline; justify-content: center; gap: 5px; font-size: clamp(18px, 4.2cqw, 30px); font-weight: 500; line-height: 1.1; white-space: nowrap; }
    .dw-duration strong { color: var(--signal); font-size: clamp(40px, min(15cqw, 18cqh), 128px); font-weight: 850; line-height: 1; letter-spacing: -0.045em; font-variant-numeric: tabular-nums; }
    .dw-unit::after { content: "minutes"; }
    .dw-reason { color: var(--dim); font-size: clamp(18px, 4.8cqw, 34px); font-weight: 550; line-height: 1.15; }
    .dw-metrics { box-sizing: border-box; width: 90%; padding-top: 6px; margin-top: 3px; border-top: 1px solid rgba(128, 128, 128, 0.2); color: var(--dim); font-size: clamp(18px, 3.8cqw, 28px); line-height: 1.2; font-variant-numeric: tabular-nums; }
    @container (max-width: 340px) { .dw-unit::after { content: "min"; } .dw-metrics { display: none; } }
    @container (max-height: 220px) { .dw-visual { flex-direction: row; gap: 8px; } .dw-light { gap: 6px; padding: 6px; } .dw-bulb { width: clamp(20px, 16cqh, 32px); } .dw-verdict { font-size: 18px; } .dw-metrics { display: none; } }
    @container (max-height: 165px) { .dw-title { display: none; } .dw-verdict { display: none; } .dw-light { padding: 3px 5px; gap: 5px; } .dw-bulb { width: 22px; } .dw-duration strong { font-size: 40px; } .dw-unit::after { content: "min"; } .dw-reason { font-size: 18px; line-height: 1; } }
  `
});
'''

REPLY_V2 = r'''{
  "name": "Walk the Dog?",
  "description": "A color-coded traffic light showing dog-walking conditions and an estimated walk duration based on temperature, rain probability, air quality and dog size.",
  "size": [12, 8, 6, 4],
  "every": 900,
  "taps": false,
  "feeds": ["wx", "aqi"],
  "hosts": [],
  "settings": {
    "dogSize": {
      "type": "choice",
      "label": "Dog size",
      "choices": ["Small", "Medium", "Large"],
      "default": "Medium"
    },
    "showDog": {
      "type": "bool",
      "label": "Show dog illustration",
      "default": true
    }
  }
}
-----CODE-----
Tile("dog-walk", {
  render(el) {
    const wx = this.feed("weather");
    const air = this.feed("air");
    const size = this.s.dogSize || "Medium";
    const showDog = this.s.showDog !== false;

    const profiles = {
      Small: { coldStop: 25, coldCaution: 45, heatCaution: 74, heatStop: 82, airCaution: 40, airStop: 90, duration: 25 },
      Medium: { coldStop: 20, coldCaution: 40, heatCaution: 78, heatStop: 85, airCaution: 50, airStop: 101, duration: 30 },
      Large: { coldStop: 15, coldCaution: 35, heatCaution: 78, heatStop: 85, airCaution: 50, airStop: 101, duration: 30 }
    };
    const p = profiles[size] || profiles.Medium;
    const num = v => typeof v === "number" && Number.isFinite(v) ? v : NaN;
    const rawTemp = num(wx?.current?.temperature_2m);
    const code = num(wx?.current?.weather_code);
    const aqi = num(air);
    const unit = wx?.current_units?.temperature_2m || "°F";
    const celsius = /C/i.test(unit);
    const temp = celsius ? rawTemp * 9 / 5 + 32 : rawTemp;

    const now = new Date();
    const hourStart = new Date(now);
    hourStart.setMinutes(0, 0, 0);
    const start = hourStart.getTime();
    const end = start + 60 * 60 * 1000;
    const hourly = wx?.hourly;
    let rain = NaN;
    if (Array.isArray(hourly?.time)) {
      for (let i = 0; i < hourly.time.length; i++) {
        const time = new Date(hourly.time[i]).getTime();
        const chance = num(hourly.precipitation_probability?.[i]);
        if (time >= start && time <= end && chance >= 0 && chance <= 100) {
          rain = Number.isFinite(rain) ? Math.max(rain, chance) : chance;
        }
      }
      if (!Number.isFinite(rain) && hourly.precipitation_probability?.length) {
        const c0 = num(hourly.precipitation_probability[0]);
        if (c0 >= 0 && c0 <= 100) rain = c0;
      }
    }

    let minutes = p.duration;
    let reason = "Comfortable outside";
    let status = "green";
    function limit(maxMinutes, why) {
      if (maxMinutes < minutes) { minutes = maxMinutes; reason = why; }
    }
    const weatherReady = Number.isFinite(temp);
    const rainReady = Number.isFinite(rain);
    const airReady = Number.isFinite(aqi) && aqi >= 0 && aqi <= 500;

    if (weatherReady) {
      if (temp >= p.heatStop) limit(0, "Too hot");
      else if (temp >= p.heatStop - 4) limit(5, "Hot pavement risk");
      else if (temp >= p.heatCaution) limit(15, "Warm outside");
      if (temp <= p.coldStop) limit(0, "Too cold");
      else if (temp <= p.coldStop + 10) limit(5, "Very cold");
      else if (temp <= p.coldCaution) limit(15, "Chilly outside");
    }
    if ([95, 96, 99].includes(code)) limit(0, "Thunderstorms");
    else if ([56, 57, 66, 67].includes(code)) limit(0, "Freezing rain");
    else if ([65, 75, 82, 86].includes(code)) limit(0, "Heavy precipitation");
    else if (code >= 51 && code <= 86) limit(10, "Wet outside");
    if (rainReady) {
      if (rain >= 85) limit(0, "Rain very likely");
      else if (rain >= 65) limit(10, "Rain likely");
      else if (rain >= 40) limit(15, "Possible rain");
    }
    if (airReady) {
      if (aqi >= p.airStop) limit(0, "Poor air quality");
      else if (aqi >= p.airStop - 20) limit(5, "Poor air quality");
      else if (aqi > p.airCaution) limit(15, "Elevated AQI");
    }

    if (minutes === 0) status = "red";
    else if (!weatherReady || !rainReady || !airReady) {
      status = "unknown"; minutes = null;
      reason = !weatherReady ? "Waiting for weather" : !rainReady ? "Waiting for forecast" : "Waiting for air quality";
    } else if (minutes < p.duration) status = "amber";

    const labels = { green: "Good to go", amber: "Short walk", red: "Skip the walk", unknown: "Checking conditions" };
    const shortLabels = { green: "Good to go", amber: "Short walk", red: "Skip walk", unknown: "Checking" };
    const metrics = [
      weatherReady ? Math.round(rawTemp) + (celsius ? "°C" : "°F") : null,
      rainReady ? "Rain " + Math.round(rain) + "%" : null,
      airReady ? "AQI " + Math.round(aqi) : null
    ].filter(Boolean).join(" · ");

    const width = el.clientWidth || 480;
    const height = el.clientHeight || 272;
    const tiny = width < 285 || height < 155;
    const compact = !tiny && (width < 400 || height < 255);
    const full = !tiny && !compact;
    const mode = tiny ? "tiny" : compact ? "compact" : "full";
    const scale = full ? Math.max(1, Math.min(width / 480, height / 272, 2.5)) : 1;
    const showTitle = full || (compact && height >= 185);
    const showReason = !tiny && (full || height >= 165);
    const showMetrics = full;

    const shortReasons = {
      "Comfortable outside": "Comfortable",
      "Hot pavement risk": "Hot pavement",
      "Heavy precipitation": "Heavy rain/snow",
      "Poor air quality": "Poor air"
    };
    const displayReason = compact ? shortReasons[reason] || reason : reason;
    const displayLabel = full && !(status === "unknown" && showDog) ? labels[status] : shortLabels[status];

    const dog = `
      <svg class="dw-dog-picture" viewBox="0 0 180 220" preserveAspectRatio="xMidYMid meet" role="img" aria-label="A cute golden puppy wearing a collar" xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="88" cy="204" rx="67" ry="9" fill="#000" opacity=".13"/>
        <path d="M126 169 C155 173 165 150 154 130 C174 143 175 172 155 186 C145 193 132 188 120 181Z" fill="#D79B53"/>
        <path d="M154 130 C164 134 170 145 169 156 C160 150 155 141 154 130Z" fill="#F5D8A6"/>
        <ellipse cx="89" cy="161" rx="49" ry="40" fill="#E6AF69"/>
        <ellipse cx="52" cy="184" rx="27" ry="17" fill="#D79B53"/>
        <ellipse cx="126" cy="184" rx="27" ry="17" fill="#D79B53"/>
        <path d="M62 126 Q90 116 117 126 L111 161 Q90 184 69 161Z" fill="#FFE6B8"/>
        <rect x="59" y="153" width="26" height="46" rx="12" fill="#F0C78A"/>
        <rect x="95" y="153" width="26" height="46" rx="12" fill="#F0C78A"/>
        <ellipse cx="70" cy="196" rx="19" ry="10" fill="#FFE6B8"/>
        <ellipse cx="108" cy="196" rx="19" ry="10" fill="#FFE6B8"/>
        <g stroke="#D5AE7D" stroke-width="1.7" stroke-linecap="round" fill="none"><path d="M64 197v4 M73 197v4"/><path d="M102 197v4 M111 197v4"/></g>
        <path d="M44 40 C18 32 9 60 15 87 C19 111 35 125 48 108 L62 57Z" fill="#A96D39"/>
        <path d="M133 40 C159 32 170 60 164 87 C160 111 144 125 131 108 L117 57Z" fill="#A96D39"/>
        <path d="M33 48 Q16 76 33 105 Q39 108 44 98 L50 54Z" fill="#BD8249"/>
        <path d="M144 48 Q162 76 145 105 Q139 108 134 98 L128 54Z" fill="#BD8249"/>
        <path d="M37 62 C37 31 61 18 89 19 C118 18 141 32 143 62 L145 85 C145 117 120 133 90 133 C58 133 34 117 34 85Z" fill="#EDBC7B"/>
        <path d="M70 24 Q72 9 85 14 Q91 1 101 18 Q114 10 119 28Z" fill="#EDBC7B"/>
        <path d="M83 25 Q90 20 97 25 Q105 45 96 62 Q88 72 80 62 Q72 45 83 25Z" fill="#F9D9A4"/>
        <path d="M48 57 Q60 49 70 55" stroke="#BD8249" stroke-width="4" fill="none" stroke-linecap="round"/>
        <path d="M110 55 Q121 49 132 57" stroke="#BD8249" stroke-width="4" fill="none" stroke-linecap="round"/>
        <ellipse cx="61" cy="74" rx="11" ry="13" fill="#392B24"/>
        <ellipse cx="119" cy="74" rx="11" ry="13" fill="#392B24"/>
        <circle cx="65" cy="69" r="4" fill="#FFF"/>
        <circle cx="123" cy="69" r="4" fill="#FFF"/>
        <circle cx="57" cy="79" r="1.8" fill="#FFF"/>
        <circle cx="115" cy="79" r="1.8" fill="#FFF"/>
        <ellipse cx="47" cy="93" rx="12" ry="6" fill="#E99B83" opacity=".65"/>
        <ellipse cx="133" cy="93" rx="12" ry="6" fill="#E99B83" opacity=".65"/>
        <ellipse cx="76" cy="98" rx="23" ry="18" fill="#FFE9C5"/>
        <ellipse cx="104" cy="98" rx="23" ry="18" fill="#FFE9C5"/>
        <path d="M75 107 Q90 132 105 107 Q90 114 75 107Z" fill="#613E35"/>
        <path d="M82 115 L98 115 L98 122 Q90 133 82 122Z" fill="#F58E9B"/>
        <path d="M90 119v6" stroke="#D66C7A" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M77 88 Q90 81 103 88 Q106 94 90 103 Q74 94 77 88Z" fill="#392B24"/>
        <ellipse cx="87" cy="88" rx="6" ry="2.4" fill="#FFF" opacity=".24"/>
        <path d="M90 101v4 M90 105 Q82 113 73 106 M90 105 Q98 113 107 106" stroke="#613E35" stroke-width="2.5" stroke-linecap="round" fill="none"/>
        <path class="dw-dog-collar" d="M58 127 Q90 140 121 127 L118 140 Q90 151 61 140Z" fill="#5D9FBA"/>
        <rect x="83" y="135" width="14" height="10" rx="3" fill="#D9E0E4"/>
        <path d="M90 148 C82 139 72 151 90 163 C108 151 98 139 90 148Z" fill="#F5CC68" stroke="#CF9F42" stroke-width="1.5"/>
      </svg>
    `;

    el.innerHTML = `
      <div class="dogwalk dogwalk-${status} dw-${mode} ${showDog ? "dw-with-dog" : "dw-no-dog"}" style="--dw-scale:${scale}">
        ${showDog ? `<div class="dw-dog">${dog}</div>` : ""}
        <div class="dw-content">
          ${showTitle ? `<div class="dw-title">Walk the dog?</div>` : ""}
          <div class="dw-visual">
            <div class="dw-light" role="img" aria-label="${this.esc(labels[status])}">
              <span class="dw-bulb dw-stop"></span>
              <span class="dw-bulb dw-caution"></span>
              <span class="dw-bulb dw-go"></span>
            </div>
            <div class="dw-verdict">${this.esc(displayLabel)}</div>
          </div>
          <div class="dw-duration">
            ${minutes === null ? `<div class="dw-duration-value"><strong class="dw-number">—</strong></div>${full ? `<span class="dw-duration-label">Try again soon</span>` : ""}` : `${full ? `<span class="dw-duration-label">Good for about</span>` : ""}<div class="dw-duration-value"><strong class="dw-number">${minutes}</strong><span class="dw-unit">${full ? "minutes" : "min"}</span></div>`}
          </div>
          ${showReason ? `<div class="dw-reason">${this.esc(displayReason)}</div>` : ""}
          ${showMetrics ? `<div class="dw-metrics">${this.esc(metrics)}</div>` : ""}
        </div>
      </div>
    `;
  },
  css: `
    .dogwalk, .dogwalk * { box-sizing: border-box; }
    .dogwalk { width: 100%; height: 100%; min-width: 0; min-height: 0; padding: 6px; display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); align-items: center; gap: 0; overflow: hidden; background: transparent; color: var(--fg); font-family: inherit; text-align: center; --signal: var(--dim); }
    .dogwalk.dw-with-dog { grid-template-columns: minmax(0, 34%) minmax(0, 1fr); gap: 8px; }
    .dogwalk.dw-no-dog { grid-template-columns: minmax(0, 1fr); gap: 0; }
    .dogwalk.dw-no-dog .dw-content { justify-self: center; align-items: center; width: 100%; }
    .dogwalk-green { --signal: #40d989; }
    .dogwalk-amber { --signal: #ffc247; }
    .dogwalk-red { --signal: #ff6269; }
    .dw-dog { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: hidden; }
    .dw-dog-picture { display: block; width: 100%; height: 100%; max-width: 360px; max-height: 100%; flex-shrink: 1; }
    .dw-content { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; height: 100%; min-width: 0; min-height: 0; gap: calc(5px * var(--dw-scale)); }
    .dw-content > * { min-width: 0; max-width: 100%; flex-shrink: 0; margin: 0; }
    .dw-title { font-size: calc(24px * var(--dw-scale)); font-weight: 650; line-height: 1.1; }
    .dw-visual { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; gap: calc(4px * var(--dw-scale)); }
    .dw-light { display: flex; flex-shrink: 0; align-items: center; justify-content: center; gap: calc(7px * var(--dw-scale)); padding: calc(6px * var(--dw-scale)); border-radius: 999px; background: #181c22; border: 1px solid rgba(128, 128, 128, .25); box-shadow: inset 0 3px 8px rgba(0, 0, 0, .3); }
    .dw-bulb { display: block; flex-shrink: 0; width: calc(34px * var(--dw-scale)); aspect-ratio: 1; border-radius: 50%; border: 2px solid rgba(255, 255, 255, .06); }
    .dw-stop { background: #49292e; }
    .dw-caution { background: #49402b; }
    .dw-go { background: #254235; }
    .dogwalk-red .dw-stop { background: #ff6269; box-shadow: 0 0 16px rgba(255, 98, 105, .55); }
    .dogwalk-amber .dw-caution { background: #ffc247; box-shadow: 0 0 16px rgba(255, 194, 71, .55); }
    .dogwalk-green .dw-go { background: #40d989; box-shadow: 0 0 16px rgba(64, 217, 137, .55); }
    .dw-verdict { color: var(--signal); font-size: calc(22px * var(--dw-scale)); font-weight: 800; line-height: 1.1; text-transform: uppercase; letter-spacing: .025em; overflow-wrap: anywhere; }
    .dw-duration { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; min-width: 0; gap: 0; }
    .dw-duration-label { font-size: calc(18px * var(--dw-scale)); font-weight: 500; line-height: 1.1; }
    .dw-duration-value { display: flex; align-items: baseline; justify-content: center; width: 100%; max-width: 100%; min-width: 0; gap: calc(5px * var(--dw-scale)); white-space: nowrap; }
    .dogwalk .dw-number { display: inline-block; flex: 0 0 auto; color: var(--signal); font-size: calc(46px * var(--dw-scale)); font-weight: 850; line-height: 1.05; letter-spacing: -.045em; font-variant-numeric: tabular-nums; }
    .dw-unit { flex: 0 0 auto; font-size: calc(19px * var(--dw-scale)); font-weight: 500; line-height: 1; }
    .dw-reason { width: 100%; color: var(--dim); font-size: calc(19px * var(--dw-scale)); font-weight: 550; line-height: 1.15; overflow-wrap: anywhere; }
    .dw-metrics { width: 100%; padding-top: calc(4px * var(--dw-scale)); border-top: 1px solid rgba(128, 128, 128, .2); color: var(--dim); font-size: calc(18px * var(--dw-scale)); line-height: 1.15; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
    .dw-no-dog .dw-metrics { width: 85%; }
    .dogwalk.dw-compact { padding: 4px; }
    .dw-compact.dw-with-dog { gap: 6px; grid-template-columns: minmax(0, 34%) minmax(0, 1fr); }
    .dw-compact .dw-content { gap: 4px; }
    .dw-compact .dw-title { font-size: 20px; }
    .dw-compact .dw-light { padding: 5px 7px; gap: 6px; }
    .dw-compact .dw-bulb { width: 26px; }
    .dw-compact .dw-visual { gap: 4px; }
    .dw-compact .dw-verdict { font-size: 19px; text-transform: uppercase; letter-spacing: .03em; }
    .dogwalk.dw-compact .dw-number { font-size: 42px; line-height: 1.05; }
    .dw-compact .dw-unit, .dw-compact .dw-reason { font-size: 18px; }
    .dogwalk.dw-tiny { padding: 2px 4px; }
    .dw-tiny.dw-with-dog { grid-template-columns: minmax(0, 28%) minmax(0, 1fr); gap: 4px; }
    .dw-tiny .dw-content { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; height: 100%; width: 100%; }
    .dw-tiny .dw-visual { display: flex; flex-direction: row; align-items: center; justify-content: center; gap: 5px; width: 100%; }
    .dw-tiny .dw-light { padding: 3px 5px; gap: 3px; }
    .dw-tiny .dw-bulb { width: 15px; height: 15px; border-width: 1px; }
    .dw-tiny .dw-verdict { display: none; }
    .dw-tiny .dw-duration-value { gap: 4px; align-items: baseline; }
    .dogwalk.dw-tiny .dw-number { font-size: 32px; line-height: 1; }
    .dw-tiny .dw-unit { font-size: 16px; line-height: 1; }
  `
});
'''

STAGE_HTML = r'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Countertop Tile Studio Demo</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 100%; height: 100%; overflow: hidden;
    background: #070a0f;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #e8eef7;
    -webkit-font-smoothing: antialiased;
  }
  .desk {
    display: grid;
    grid-template-columns: 1172px 1fr;
    gap: 12px;
    width: 100%; height: 100%;
    padding: 12px;
    background: #080b10;
  }
  .win {
    display: flex; flex-direction: column;
    background: #0f131a;
    border: 1px solid rgba(255,255,255,0.11);
    border-radius: 14px;
    overflow: hidden;
    box-shadow: 0 20px 50px rgba(0,0,0,0.55);
    min-width: 0; min-height: 0;
  }
  .bar {
    height: 36px; flex: none;
    display: flex; align-items: center; gap: 10px;
    padding: 0 14px;
    background: #141923;
    border-bottom: 1px solid rgba(255,255,255,0.08);
    user-select: none;
  }
  .dots { display: flex; gap: 7px; }
  .dots span { width: 11px; height: 11px; border-radius: 50%; display: block; opacity: .85; }
  .dots .r { background: #ff5f57; }
  .dots .y { background: #febc2e; }
  .dots .g { background: #28c840; }
  .wtitle {
    flex: 1; text-align: center;
    font-size: 13px; font-weight: 600; color: #b8c4d6;
    letter-spacing: 0.01em;
    display: flex; align-items: center; justify-content: center; gap: 7px;
  }
  .wtitle .url {
    font-weight: 400; color: #6e7d94; font-size: 12px;
    background: rgba(255,255,255,0.05); padding: 2px 10px; border-radius: 99px;
  }
  .spacer { width: 47px; }
  .studio-frame {
    width: 100%; flex: 1; border: 0; background: #0f131a; display: block;
  }
  .chat-win { background: #10141c; }
  .chat-body {
    flex: 1; min-height: 0;
    overflow-y: auto;
    padding: 18px 16px 14px;
    display: flex; flex-direction: column; gap: 14px;
    scroll-behavior: smooth;
  }
  .chat-body::-webkit-scrollbar { width: 6px; }
  .chat-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 99px; }
  .chat-empty {
    margin: auto; text-align: center; color: #6f7e94;
    display: flex; flex-direction: column; align-items: center; gap: 10px;
    padding: 20px;
  }
  .sparkle {
    width: 44px; height: 44px; border-radius: 14px;
    background: linear-gradient(135deg, rgba(108,180,255,0.18), rgba(139,115,255,0.18));
    border: 1px solid rgba(130,185,255,0.28);
    display: grid; place-items: center;
    color: #8cc4ff;
  }
  .chat-empty h3 { font-size: 18px; color: #dce5f2; font-weight: 600; }
  .chat-empty p { font-size: 13.5px; line-height: 1.45; max-width: 280px; }
  .msg { display: flex; flex-direction: column; gap: 6px; animation: pop .22s ease-out; }
  @keyframes pop { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
  .msg.user { align-items: flex-end; }
  .msg.ai { align-items: stretch; }
  .who {
    font-size: 11px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase;
    color: #77879f; padding: 0 4px;
    display: flex; align-items: center; gap: 6px;
  }
  .who .badge-dot { width: 7px; height: 7px; border-radius: 50%; background: #6cb4ff; display: inline-block; }
  .bubble {
    background: #1c2636;
    border: 1px solid rgba(124,175,240,0.22);
    border-radius: 14px 14px 4px 14px;
    padding: 11px 13px;
    max-width: 94%;
    font-size: 13.5px; line-height: 1.42; color: #eaf1fb;
  }
  .bubble .meta-tag {
    display: inline-flex; align-items: center; gap: 5px;
    margin-top: 8px;
    font-size: 11.5px; color: #8ab8ef;
    background: rgba(108,180,255,0.12);
    border: 1px solid rgba(108,180,255,0.22);
    border-radius: 99px;
    padding: 3px 9px;
  }
  .bubble .meta-tag.warn {
    color: #ffd588;
    background: rgba(255,194,71,0.13);
    border-color: rgba(255,194,71,0.28);
  }
  .pin-inline {
    display: inline-grid; place-items: center;
    width: 18px; height: 18px; border-radius: 50%;
    background: #ffd54a; color: #111; font-weight: 800; font-size: 11px;
    margin-right: 5px; vertical-align: -1px;
  }
  .thinking {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 10px 14px; border-radius: 12px;
    background: #161c27; border: 1px solid rgba(255,255,255,0.08);
    color: #9bb0cc; font-size: 13px; align-self: flex-start;
  }
  .tdots { display: inline-flex; gap: 4px; }
  .tdots span {
    width: 6px; height: 6px; border-radius: 50%; background: #7ab7ff;
    animation: pulse 1s infinite ease-in-out;
  }
  .tdots span:nth-child(2) { animation-delay: .18s; }
  .tdots span:nth-child(3) { animation-delay: .36s; }
  @keyframes pulse { 0%, 80%, 100% { opacity: .25; transform: scale(.85); } 40% { opacity: 1; transform: scale(1.1); } }
  .code-card {
    background: #0c1017;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 12px;
    overflow: hidden;
  }
  .code-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 10px 8px 12px;
    background: #161c26;
    border-bottom: 1px solid rgba(255,255,255,0.08);
    font-size: 12px; color: #a7b6cb; font-weight: 600;
  }
  .copy-btn {
    border: 1px solid rgba(108,180,255,0.35);
    background: #233349;
    color: #dbeeff;
    font: inherit; font-size: 12px; font-weight: 600;
    padding: 4px 11px; border-radius: 8px;
    cursor: pointer; transition: all .15s;
  }
  .copy-btn.copied {
    background: #1c3e2e; border-color: #40d989; color: #7ef2b1;
  }
  .code-pre {
    padding: 10px 12px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11.5px; line-height: 1.42; color: #c7d4e6;
    white-space: pre; overflow: hidden;
  }
  .ck { color: #7ec4ff; }
  .cs { color: #9ee09e; }
  .cd { color: #ffd56b; font-weight: 700; }
  .cm { color: #67778f; }
  .composer {
    flex: none;
    padding: 12px 14px 14px;
    border-top: 1px solid rgba(255,255,255,0.08);
    background: #131822;
  }
  .comp-box {
    display: flex; align-items: flex-end; gap: 8px;
    background: #1b2230;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 14px;
    padding: 8px 8px 8px 12px;
    transition: border-color .15s;
  }
  .comp-box.active { border-color: #6cb4ff; }
  .comp-input {
    flex: 1; background: transparent; border: 0; outline: none; resize: none;
    color: #eef4fc; font: inherit; font-size: 13.5px; line-height: 1.38;
    min-height: 38px; max-height: 82px;
  }
  .comp-input::placeholder { color: #67768c; }
  .send-btn {
    width: 34px; height: 34px; flex: none;
    border-radius: 10px; border: 0;
    background: #283344; color: #7d8da5;
    display: grid; place-items: center;
    cursor: pointer; transition: all .15s;
  }
  .send-btn.ready { background: #6cb4ff; color: #071423; }
  #demo-pointer {
    position: fixed; z-index: 999999; pointer-events: none;
    left: 560px; top: 440px;
    width: 30px; height: 34px;
    filter: drop-shadow(0 3px 6px rgba(0,0,0,0.55));
    transform: translate(-2px, -2px);
    transition: left 340ms cubic-bezier(0.22, 1, 0.36, 1), top 340ms cubic-bezier(0.22, 1, 0.36, 1), transform 90ms ease;
  }
  #demo-pointer.snap { transition: transform 90ms ease; }
  #demo-pointer.down { transform: translate(-2px, -2px) scale(0.86); }
  .click-ring {
    position: fixed; z-index: 999998; pointer-events: none;
    width: 14px; height: 14px; border-radius: 50%;
    border: 3px solid #7ec4ff;
    transform: translate(-50%, -50%) scale(0.4);
    opacity: 0.95;
    animation: ring .42s ease-out forwards;
  }
  @keyframes ring {
    to { transform: translate(-50%, -50%) scale(2.8); opacity: 0; }
  }
</style>
</head>
<body>
<div class="desk">
  <div class="win">
    <div class="bar">
      <div class="dots"><span class="r"></span><span class="y"></span><span class="g"></span></div>
      <div class="wtitle">Countertop — Tile Studio <span class="url">192.0.2.20:8090/control</span></div>
      <div class="spacer"></div>
    </div>
    <iframe id="studio" class="studio-frame" src="/control"></iframe>
  </div>
  <div class="win chat-win">
    <div class="bar">
      <div class="dots"><span class="r"></span><span class="y"></span><span class="g"></span></div>
      <div class="wtitle">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8cc4ff" stroke-width="2.2"><path d="M12 3l2.2 6.3L20.5 11.5l-6.3 2.2L12 20l-2.2-6.3L3.5 11.5l6.3-2.2z"/></svg>
        Your AI chat <span class="url">ChatGPT, Claude, etc.</span>
      </div>
      <div class="spacer"></div>
    </div>
    <div id="chatBody" class="chat-body">
      <div id="chatEmpty" class="chat-empty">
        <div class="sparkle">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l2.2 6.3L20.5 11.5l-6.3 2.2L12 20l-2.2-6.3L3.5 11.5l6.3-2.2z"/></svg>
        </div>
        <h3>Your own AI assistant</h3>
        <p>Use ChatGPT, Claude, or any assistant in another window — Countertop has no built-in AI.</p>
      </div>
    </div>
    <div class="composer">
      <div id="compBox" class="comp-box">
        <textarea id="compInput" class="comp-input" rows="2" placeholder="Paste your Tile Studio prompt…"></textarea>
        <button id="sendBtn" class="send-btn" aria-label="Send">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
        </button>
      </div>
    </div>
  </div>
</div>

<div id="demo-pointer">
  <svg viewBox="0 0 34 38"><path fill="#ffffff" stroke="#102030" stroke-width="2.4" stroke-linejoin="round" d="M2 2l25 18-11 2 5 12-5 2-6-12-8 8z"/></svg>
</div>

<script>
window.__setPointer = (x, y, snap) => {
  const p = document.getElementById("demo-pointer");
  p.classList.toggle("snap", !!snap);
  p.style.left = x + "px";
  p.style.top = y + "px";
};
window.__clickEffect = (x, y) => {
  const p = document.getElementById("demo-pointer");
  p.classList.add("down");
  setTimeout(() => p.classList.remove("down"), 120);
  const r = document.createElement("div");
  r.className = "click-ring";
  r.style.left = x + "px";
  r.style.top = y + "px";
  document.body.appendChild(r);
  setTimeout(() => r.remove(), 440);
};
const chatBody = document.getElementById("chatBody");
const compInput = document.getElementById("compInput");
const compBox = document.getElementById("compBox");
const sendBtn = document.getElementById("sendBtn");
window.__chatPaste = (previewText) => {
  compBox.classList.add("active");
  compInput.value = previewText;
  sendBtn.classList.add("ready");
};
window.__chatSend = (htmlBubble) => {
  const empty = document.getElementById("chatEmpty");
  if (empty) empty.remove();
  compInput.value = "";
  compBox.classList.remove("active");
  sendBtn.classList.remove("ready");
  const m = document.createElement("div");
  m.className = "msg user";
  m.innerHTML = '<div class="who">You</div><div class="bubble">' + htmlBubble + '</div>';
  chatBody.appendChild(m);
  chatBody.scrollTop = chatBody.scrollHeight;
};
window.__chatThinking = (label) => {
  const m = document.createElement("div");
  m.className = "msg ai";
  m.id = "thinkingMsg";
  m.innerHTML = '<div class="who"><span class="badge-dot"></span>Assistant</div>' +
    '<div class="thinking"><span class="tdots"><span></span><span></span><span></span></span>' + label + '</div>';
  chatBody.appendChild(m);
  chatBody.scrollTop = chatBody.scrollHeight;
};
window.__chatReply = (id, title, codeHtml) => {
  const t = document.getElementById("thinkingMsg");
  if (t) t.remove();
  const m = document.createElement("div");
  m.className = "msg ai";
  m.innerHTML = '<div class="who"><span class="badge-dot"></span>Assistant</div>' +
    '<div class="code-card"><div class="code-head"><span>' + title + '</span>' +
    '<button class="copy-btn" id="' + id + '">Copy</button></div>' +
    '<pre class="code-pre">' + codeHtml + '</pre></div>';
  chatBody.appendChild(m);
  chatBody.scrollTop = chatBody.scrollHeight;
};
window.__chatMarkCopied = (id) => {
  const b = document.getElementById(id);
  if (!b) return;
  b.classList.add("copied");
  b.textContent = "Copied ✓";
};
</script>
</body>
</html>
'''

CODE_SNIPPET_1 = (
    '{\n'
    '  <span class="ck">"name"</span>: <span class="cs">"Walk the Dog?"</span>,\n'
    '  <span class="ck">"size"</span>: [12, 8, 6, 4],\n'
    '  <span class="ck">"feeds"</span>: [<span class="cs">"wx"</span>, <span class="cs">"aqi"</span>],\n'
    '  <span class="ck">"settings"</span>: { <span class="ck">"dogSize"</span>: ... }\n'
    '}\n'
    '<span class="cd">-----CODE-----</span>\n'
    'Tile(<span class="cs">"dog-walk"</span>, {\n'
    '  render(el) {\n'
    '    const wx = this.feed(<span class="cs">"weather"</span>);\n'
    '    const air = this.feed(<span class="cs">"air"</span>);\n'
    '    <span class="cm">// traffic light + duration</span>\n'
    '  }\n'
    '});'
)

CODE_SNIPPET_2 = (
    '{\n'
    '  <span class="ck">"name"</span>: <span class="cs">"Walk the Dog?"</span>,\n'
    '  <span class="ck">"feeds"</span>: [<span class="cs">"wx"</span>, <span class="cs">"aqi"</span>],\n'
    '  <span class="ck">"settings"</span>: { <span class="ck">"dogSize"</span>, <span class="ck">"showDog"</span> }\n'
    '}\n'
    '<span class="cd">-----CODE-----</span>\n'
    'Tile(<span class="cs">"dog-walk"</span>, {\n'
    '  render(el) {\n'
    '    <span class="cm">// golden puppy SVG + tiny fix</span>\n'
    '    const dog = <span class="cs">`&lt;svg class="dw-dog"&gt;…`</span>;\n'
    '  }\n'
    '});'
)

VIEW_W = 1660
VIEW_H = 934


class Cursor:
    def __init__(self, page):
        self.page = page
        self.x = 580.0
        self.y = 320.0
        page.evaluate(f"window.__setPointer({self.x}, {self.y}, true)")

    def move_to(self, tx, ty, ms=360):
        self.page.evaluate(f"window.__setPointer({tx:.1f}, {ty:.1f}, false)")
        self.page.wait_for_timeout(ms)
        self.x, self.y = float(tx), float(ty)

    def click_locator(self, locator, ms=340):
        b = locator.bounding_box()
        tx, ty = b["x"] + b["width"] / 2, b["y"] + b["height"] / 2
        self.move_to(tx, ty, ms=ms)
        self.page.wait_for_timeout(60)
        self.page.evaluate(f"window.__clickEffect({tx:.1f}, {ty:.1f})")
        locator.click()
        self.page.wait_for_timeout(110)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    scratch = Path(tempfile.mkdtemp(prefix="ct-gif-studio-"))
    shutil.copytree(REPO / "tools", scratch / "tools")
    shutil.copytree(REPO / "demo" / "work", scratch / "work")
    video_dir = scratch / "video"
    video_dir.mkdir()

    env = dict(os.environ, COUNTERTOP_DATA=str(scratch / "work"), COUNTERTOP_NO_UPDATE_CHECK="1")
    proc = subprocess.Popen(
        [
            "python3", "-u", "-c",
            "from tools.countertop import Handler, ThreadingHTTPServer\n"
            "s = ThreadingHTTPServer(('127.0.0.1', 0), Handler)\n"
            "print(s.server_port, flush=True)\n"
            "s.serve_forever()\n",
        ],
        cwd=scratch, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )

    try:
        port = proc.stdout.readline().strip()
        base = f"http://127.0.0.1:{port}"
        fixtures = (REPO / "demo" / "fixtures" / "demo-data.js").read_text(encoding="utf-8")

        with sync_playwright() as p:
            browser = p.chromium.launch()
            ctx = browser.new_context(
                viewport={"width": VIEW_W, "height": VIEW_H},
                timezone_id="America/Denver",
                locale="en-US",
                record_video_dir=str(video_dir),
                record_video_size={"width": VIEW_W, "height": VIEW_H},
            )
            ctx.add_init_script(
                'window.__DEMO_TIME = "2026-11-19T09:24:00-07:00";\n'
                'window.__DEMO_SAVE_CONFIG = true;\n' + fixtures
            )
            page = ctx.new_page()
            page.route(
                "**/demo-stage",
                lambda route: route.fulfill(content_type="text/html; charset=utf-8", body=STAGE_HTML),
            )

            t_nav = time.monotonic()
            page.goto(base + "/demo-stage")
            studio = page.frame_locator("#studio")
            page.wait_for_function(
                "() => document.getElementById('studio').contentWindow && "
                "typeof document.getElementById('studio').contentWindow.stuOpen === 'function'",
                timeout=15000,
            )

            page.evaluate("""() => {
              const win = document.getElementById('studio').contentWindow;
              const st = win.document.createElement('style');
              st.textContent = `
                #lib { grid-template-columns: 186px minmax(0,1fr) !important; }
                .lmain { padding: 14px 20px 60px !important; }
                .lstu { gap: 20px !important; grid-template-columns: minmax(0,1fr) minmax(360px,0.96fr) !important; }
                .lpanel { margin-bottom: 10px !important; }
                .ltitle { font-size: 26px !important; margin-bottom: 6px !important; }
                .lmain > .lback { margin: 0 0 6px !important; }
              `;
              win.document.head.appendChild(st);
              win.libOpen('tiles');
              win.stuOpen('');
            }""")
            page.wait_for_timeout(1500)

            studio_frame = [f for f in page.frames if "/control" in f.url][0]

            def scroll_studio(y):
                page.evaluate(
                    f"() => {{ const m = document.getElementById('studio').contentDocument.querySelector('.lmain'); "
                    f"m.scrollTo({{top: {y}, behavior: 'smooth'}}); }}"
                )
                page.wait_for_timeout(380)

            cur = Cursor(page)
            t_start = time.monotonic() - t_nav

            # Opening beat
            page.wait_for_timeout(700)

            # Step 1: Describe the tile and copy for chat
            ask_box = studio.locator('#lib [data-s="ask"]')
            cur.click_locator(ask_box, ms=320)
            for i in range(0, len(PROMPT_ASK), 12):
                ask_box.fill(PROMPT_ASK[: i + 12])
                page.wait_for_timeout(52)
            page.wait_for_timeout(240)
            cur.click_locator(studio.locator('#lib [data-l="s-ai"]'), ms=280)
            page.wait_for_timeout(380)

            # Paste into AI Chat, send, copy reply
            cur.click_locator(page.locator("#compInput"), ms=380)
            page.evaluate(
                'window.__chatPaste(\'Please design a tile for my Countertop home dashboard...\\n'
                'A "Walk the dog?" tile using weather and air quality...\')'
            )
            page.wait_for_timeout(300)
            cur.click_locator(page.locator("#sendBtn"), ms=240)
            page.evaluate("""() => {
              window.__chatSend(
                '<b>A "Walk the dog?" tile</b> using weather and air quality. Big traffic light (green, amber, red), "Good for about N minutes", a short reason, and a dog size setting.' +
                '<div class="meta-tag">+ Countertop tile rules &amp; JSON shape</div>'
              );
              window.__chatThinking('Designing tile…');
            }""")
            page.wait_for_timeout(850)
            page.evaluate(f"window.__chatReply('copy1', 'Walk the Dog? · JSON + JS', {json.dumps(CODE_SNIPPET_1)})")
            page.wait_for_timeout(360)
            cur.click_locator(page.locator("#copy1"), ms=300)
            page.evaluate("window.__chatMarkCopied('copy1')")
            page.wait_for_timeout(260)

            # Step 2: Paste reply and Fill in the form
            cur.click_locator(studio.locator('#lib [data-s="reply"]'), ms=380)
            studio.locator('#lib [data-s="reply"]').fill(REPLY_V1)
            page.wait_for_timeout(220)
            cur.click_locator(studio.locator('#lib [data-l="s-fill"]'), ms=260)

            studio_frame.wait_for_function(
                "() => document.querySelector('#lib .lstu-log').innerText.includes('At Smallest:')",
                timeout=10000,
            )
            page.wait_for_timeout(1200)
            fit_warn_count = studio.locator('#lib .lstu-log').inner_text().count("At Smallest:")

            # Point at something and add a note
            scroll_studio(140)
            cur.click_locator(studio.locator('#lib [data-l="s-pick"]'), ms=320)
            studio.locator('#lib .lstu-shot.pick').wait_for(timeout=10000)
            studio_frame.wait_for_function("""() => {
              const f = document.querySelector('#lib .lstu-shot iframe');
              return STU.picking && f && f.contentWindow && f.contentWindow.dashSbxPickKey === stuPickCfg().key;
            }""", timeout=10000)
            page.wait_for_timeout(280)

            tile_frame = None
            for f in page.frames:
                if "/tile-frame/draft-" in f.url and f.parent_frame and "&w=12&h=8" in f.parent_frame.url:
                    tile_frame = f
            assert tile_frame is not None, "Could not find preview tile frame"

            shot_box = studio.locator('#lib .lstu-shot').bounding_box()
            lx = shot_box["x"] + shot_box["width"] * 0.62
            ly = shot_box["y"] + shot_box["height"] * 0.45
            cur.move_to(lx, ly, ms=360)
            page.wait_for_timeout(110)
            page.evaluate(f"window.__clickEffect({lx:.1f}, {ly:.1f})")
            tile_frame.locator(".dw-verdict").click()
            studio.locator('#lib [data-s="pend"]').wait_for(timeout=10000)
            page.wait_for_timeout(280)

            scroll_studio(410)
            pend_box = studio.locator('#lib [data-s="pend"]')
            cur.click_locator(pend_box, ms=280)
            note_text = "Add a cute golden puppy on the left"
            for i in range(0, len(note_text), 5):
                pend_box.fill(note_text[: i + 5])
                page.wait_for_timeout(44)
            page.wait_for_timeout(220)

            cur.click_locator(studio.locator('#lib [data-l="s-pickadd"]'), ms=260)
            studio.locator('#lib .lstu-n').first.wait_for(timeout=5000)
            scroll_studio(150)
            page.wait_for_timeout(1050)

            scroll_studio(380)
            cur.click_locator(studio.locator('#lib [data-l="s-ai2"]'), ms=280)
            page.wait_for_timeout(380)

            # Send change request in AI Chat and copy updated version
            cur.click_locator(page.locator("#compInput"), ms=380)
            paste2 = (
                'Make these changes and keep everything else the same.\n'
                '1. the text "Good to go": Add a cute golden puppy on the left\n'
                f"+ Fix {fit_warn_count} smallest-size fit warnings..."
            )
            page.evaluate(f"window.__chatPaste({json.dumps(paste2)})")
            page.wait_for_timeout(300)
            cur.click_locator(page.locator("#sendBtn"), ms=240)
            bubble2 = (
                '<div><span class="pin-inline">1</span><b>"Good to go":</b> Add a cute golden puppy on the left</div>'
                f'<div class="meta-tag warn">+ {fit_warn_count} smallest-size fit fixes included</div>'
            )
            page.evaluate(f"""() => {{
              window.__chatSend({json.dumps(bubble2)});
              window.__chatThinking('Updating tile…');
            }}""")
            page.wait_for_timeout(850)
            page.evaluate(f"window.__chatReply('copy2', 'Walk the Dog? (v2) · + puppy SVG', {json.dumps(CODE_SNIPPET_2)})")
            page.wait_for_timeout(360)
            cur.click_locator(page.locator("#copy2"), ms=300)
            page.evaluate("window.__chatMarkCopied('copy2')")
            page.wait_for_timeout(260)

            # Fill in updated tile and show version switcher
            scroll_studio(0)
            cur.click_locator(studio.locator('#lib [data-s="reply"]'), ms=380)
            studio.locator('#lib [data-s="reply"]').fill(REPLY_V2)
            page.wait_for_timeout(220)
            cur.click_locator(studio.locator('#lib [data-l="s-fill"]'), ms=260)
            page.wait_for_timeout(2200)

            v2_btn = studio.locator('#lib .lstu-ver [data-l="s-ver"]').nth(1)
            v3_btn = studio.locator('#lib .lstu-ver [data-l="s-ver"]').nth(2)
            cur.click_locator(v2_btn, ms=320)
            page.wait_for_timeout(950)
            cur.click_locator(v3_btn, ms=240)
            b3 = v3_btn.bounding_box()
            cur.move_to(b3["x"] + 95, b3["y"] + 40, ms=220)
            page.wait_for_timeout(2200)

            duration = (time.monotonic() - t_nav) - t_start
            vid_path = page.video.path()
            ctx.close()
            browser.close()

        gif_out = OUT / "tile-studio.gif"
        mp4_tmp = scratch / "clean.mp4"
        ffmpeg = os.environ.get("FFMPEG", "ffmpeg")
        speed = 1.42
        subprocess.run(
            [
                ffmpeg, "-v", "error", "-y",
                "-ss", f"{t_start:.3f}", "-t", f"{duration:.3f}", "-i", vid_path,
                "-vf", f"setpts=PTS/{speed},fps=24,scale=1280:-2:flags=lanczos",
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "22", str(mp4_tmp),
            ],
            check=True,
        )
        vf = (
            "fps=8,scale=960:-2:flags=lanczos,"
            "split[a][b];[a]palettegen=max_colors=112:stats_mode=diff[p];"
            "[b][p]paletteuse=dither=none:diff_mode=rectangle"
        )
        subprocess.run(
            [ffmpeg, "-v", "error", "-y", "-i", str(mp4_tmp), "-vf", vf, "-loop", "0", str(gif_out)],
            check=True,
        )
        print(f"Wrote {gif_out} ({gif_out.stat().st_size / 1024 / 1024:.2f} MB)")
    finally:
        proc.terminate()
        shutil.rmtree(scratch, ignore_errors=True)


if __name__ == "__main__":
    main()
