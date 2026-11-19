# Install Countertop on Docker or Unraid

Countertop serves the dashboard on TCP port 8090. Keep it on a trusted local network. Anyone who can reach the port can use Controls and change settings, so keep the port off the public internet.

## Docker Compose

On a host with Docker and Docker Compose:

```sh
mkdir -p countertop/data
cd countertop
curl -fLo compose.yml https://raw.githubusercontent.com/kizit/countertop/main/docker/compose.release.yml
printf 'PUID=%s\nPGID=%s\nTZ=%s\n' "$(id -u)" "$(id -g)" 'America/Chicago' > .env
docker compose up -d
docker compose ps
```

Replace `America/Chicago` with your IANA time zone, such as `America/New_York`, before starting. Run the setup from your regular user account so the container's `PUID` and `PGID` match the owner of `data/`. If port 8090 is occupied, add `COUNTERTOP_PORT=8091` to `.env` and use that port in your browser.

The image is available for Linux `amd64` and `arm64`. Compose defaults to `ghcr.io/kizit/countertop:latest`. To pin a version, add `COUNTERTOP_IMAGE=ghcr.io/kizit/countertop:v0.1.0` to `.env`.

To update, back up `data/`, then run `docker compose pull` and `docker compose up -d`. To stop, run `docker compose down`. Your settings, source links, groceries and purchase exports live in the bind mount at `data/`. Keep that folder and its backups private.

## Unraid

1. Create a persistent directory from the Unraid terminal. These commands apply to a fresh installation. For an existing data directory, check its ownership and back it up before changing anything.

   ```sh
   mkdir -p /mnt/user/appdata/countertop
   chown 99:100 /mnt/user/appdata/countertop
   chmod 750 /mnt/user/appdata/countertop
   ```

2. In the Unraid web interface, open **Docker → Add Container**.
3. Set **Name** to `Countertop`, **Repository** to `ghcr.io/kizit/countertop:latest` and **Network Type** to **Bridge**.
4. Add a **Port** mapping for TCP 8090 in the container to port 8090 on the host. Choose a different host port if needed.
5. Add a read/write **Path** mapping from `/mnt/user/appdata/countertop` on the host to `/app/work` in the container.
6. Add a **Variable** named `TZ` with your IANA time zone. In advanced view, set **Extra Parameters** to `--user 99:100 --restart unless-stopped`. Apply.

The [Unraid XML template](../docker/unraid/countertop.xml) defines the same settings. The contents of `/mnt/user/appdata/countertop` persist across container replacements.

## First run

- Open `http://SERVER-IP:8090/control` to set your location and configure the dashboard.
- Open `http://SERVER-IP:8090/dash` in Silk on the Echo Show. Tap once to start the full-screen keep-alive.
- Open `http://SERVER-IP:8090/list` on a phone to use the shared grocery list. Use **This dashboard** as the list source. Native Apple Reminders synchronization requires macOS.

If setup fails to save, check container logs and verify the selected UID and GID can write to the mounted directory. If the dashboard fails to open, check that `http://SERVER-IP:8090/version` returns JSON from a computer on the same network.

## Build from source

On a Linux Docker host, clone the repo. The source Compose file runs as UID/GID `99:100` by default. For a clean checkout:

```sh
git clone https://github.com/kizit/countertop.git
cd countertop
mkdir -p docker/data
sudo chown 99:100 docker/data
docker compose -f docker/docker-compose.yml up -d --build
```

Set `TZ` in `docker/docker-compose.yml` to your local time zone. This setup keeps its settings in `docker/data/`.
