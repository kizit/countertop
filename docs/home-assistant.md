# Home Assistant

Countertop can show lights, doors and sensors from [Home Assistant](https://www.home-assistant.io/), and switch lights and run scenes when someone taps the screen.

![A Home tile with light switches, door and lock states, and four Sensor tiles: outside temperature, an unlocked kitchen door in orange, the garage door and power use](screenshots/home-assistant.png)

## Connect Home Assistant

1. In Home Assistant, open your profile (your name at the bottom left), then the **Security** tab. Under **Long-lived access tokens**, choose **Create token**, name it Countertop, and copy it. Home Assistant shows it only once.
2. In Countertop, open **Controls → Setup → Home Assistant → Add a Home Assistant**.
3. Give it a name, type the address you open Home Assistant at, such as `http://192.168.1.20:8123`, and paste the token.
4. Choose **Test connection**. It should say how many entities it found. Then choose **Add**.

**Running Countertop in Docker or on Unraid?** Use Home Assistant's IP address. Names ending in `.local`, like `homeassistant.local`, often don't work inside a Docker container.

## Add the tiles

Choose **Edit dashboard on screen**, add a tile from the **Home** group, and pick what it shows in its settings. Type in the search box to find things by name, like "kitchen" or "door".

| Tile | What it shows | What taps do |
| --- | --- | --- |
| **Home** | A list of the things you pick, in your order, with their state: "Closed", "Locked", "61.3 °F" | Lights, switches, fans and helper toggles get an on/off switch, and lights and fans a brightness or speed − / +. Thermostats get − / + for the target and mode buttons. Blinds and other covers get open / close / stop, media players play / pause, skip and volume, vacuums start / pause / back to base. Numbers, selects, buttons and text helpers get a − / +, option buttons, Press, or a text box. Scenes and scripts get a Run button, and tapping a plain sensor refreshes it. |
| **Sensor** | One thing in big type, such as the outside temperature or the garage door | Pick a "Controlled by" entity, such as the thermostat for a temperature sensor, and its controls appear under the value. It can take over its box while it needs a look, such as a door left open. |

Doors left open, locks left unlocked and water sensors that are wet are shown in orange.

A temperature driven by a thermostat (the tile's **Controlled by** setting, e.g. a room sensor showing `climate.salon`) is coloured by what the thermostat is doing: orange while it heats, green once the room reaches the setpoint, and grey when it is off. Cooling shows blue. Turn off **Colour by the thermostat** in the tile's settings to keep the number plain.

## Locks, garage doors and alarms

Locks, alarm panels, and garage doors, gates and doors (covers) are shown on every tile, but a tile can only change them when **Allow locks, garage doors and alarms** is on in its settings. It's off by default, because a kitchen screen is within reach of guests and kids.

With it on, **Locks, garage doors and alarms need** picks **Two taps** (the default: the first tap shows "Tap again to unlock Front door", and the second within six seconds does it) or **One tap**. The server checks both settings, so a tile can't skip them.

Every tile can only reach the things it shows, following its own settings. Turn off **Let the screen control these things** to make a tile display only. Settings are open to anyone on your home network, so these settings guard against accidental taps, not against someone on your Wi-Fi.

## How it works

- The token stays on the Countertop server, in its data folder, readable only by the server. Controls only shows that a token is saved; it never sends it back to a browser. It is removed from the diagnostics file along with anything that looks like a token.
- The server asks Home Assistant for the state of everything every few seconds, but only while a Home or Sensor tile is showing, and shares that answer between tiles. A tap asks Home Assistant to switch the light, then reads its state again right away.
- **Controls → Status** shows when Countertop last heard from Home Assistant, or why it couldn't.

## Homebridge

Homebridge is made to show devices in Apple Home and has no supported way for other apps to read or switch them. If you use Homebridge, Home Assistant's HomeKit Device integration can add a Homebridge bridge, and its devices then work in these tiles.

## Try it without a smart home

Home Assistant's demo integration fills it with pretend lights, doors and sensors. Run a throwaway Home Assistant in Docker and add `demo:` to its `configuration.yaml`:

```sh
mkdir -p ha-demo && printf 'default_config:\ndemo:\n' > ha-demo/configuration.yaml
docker run -d --name ha-demo -p 8123:8123 -v "$PWD/ha-demo:/config" ghcr.io/home-assistant/home-assistant:stable
```

Open `http://localhost:8123`, create a user, then make a token as above. Remove it with `docker rm -f ha-demo`.
