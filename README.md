# herdr-remote

Remote control for [herdr](https://herdr.dev) agents across multiple computers.

This fork is built around one simple model: each computer runs its own local relay, each relay is exposed through its own Cloudflare Tunnel hostname, and the phone web app connects to all relays directly. The browser merges the agent lists into one page, so a phone can approve agents running on a Mac and on a Fedora workstation without either computer connecting to the other.

This repo no longer uses the original Telegram bot, native Herdi apps, terminal dashboard, or SSH remote fan-out. The relay only talks to local `herdr`; multi-computer support happens in the web app.

## Current Model

- Run one relay per computer.
- Expose each relay with a distinct `wss://` hostname, for example `relay-mac.example.com` and `relay-fedora.example.com`.
- Reuse the same `HERDR_RELAY_TOKEN` on multiple relays if you want one shared secret.
- Add each relay URL to the web app Settings with a display label such as `Mac` or `Fedora`.
- Keep the computers independent. There is no Mac-to-Fedora SSH, Fedora-to-Mac SSH, or shared Cloudflare tunnel for different local relays.

## Components

- **Relay**: local Python WebSocket/HTTP service on port `8375`; polls only local `herdr`.
- **Web app**: static mobile UI in `web/`; stores multiple relay configs in browser local storage and merges agent lists client-side.
- **Cloudflare Tunnel**: exposes each relay without opening inbound ports. Use a separate hostname per computer.
- **Background services**: launchd on macOS and user systemd on Linux/Fedora start both the relay and `cloudflared`.
- **herdr plugin hook**: optional local event push from `herdr` into the local relay for faster blocked-agent updates.

## Quick Start

Start a temporary tunnel:

```bash
./relay/start.sh
```

The script starts the relay and prints a temporary Cloudflare quick tunnel URL:

```text
Tunnel URL: https://example.trycloudflare.com
WebSocket:  wss://example.trycloudflare.com
```

Open your deployed web app on your phone and add the printed `wss://...trycloudflare.com` URL in Settings. Quick tunnels are temporary; the hostname changes when the tunnel restarts.

## Web App

The web app is static and lives in `web/`.

Deploy it anywhere that can host static files. With Cloudflare Pages direct upload:

```bash
cp .env.example .env
# edit WEB_PROJECT in .env
make web-deploy
```

In the app Settings:

- **Relay Name**: a display label such as `Mac` or `Fedora`
- **Relay URL**: `wss://...`
- **Token**: value of `HERDR_RELAY_TOKEN` if relay auth is enabled

Add one relay entry for each computer you want on the same page. The relay name is what the phone UI displays as the host badge, for example `@Mac` or `@Fedora`.

## Named Tunnel

For a stable relay hostname, create a named Cloudflare tunnel on each computer and route a DNS name you control:

```bash
# On the Mac
cloudflared tunnel login
cloudflared tunnel create herdr-remote-mac
cloudflared tunnel route dns herdr-remote-mac relay-mac.yourdomain.com

# On Fedora
cloudflared tunnel create herdr-remote-fedora
cloudflared tunnel route dns herdr-remote-fedora relay-fedora.yourdomain.com
```

Create `~/.cloudflared/config-herdr-remote.yml` on each computer. Example for the Mac:

```yaml
tunnel: herdr-remote-mac
credentials-file: /Users/you/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: relay-mac.yourdomain.com
    service: http://localhost:8375
  - service: http_status:404
```

For Fedora, use the Fedora tunnel name, credentials file, and hostname:

```yaml
tunnel: herdr-remote-fedora
credentials-file: /home/you/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: relay-fedora.yourdomain.com
    service: http://localhost:8375
  - service: http_status:404
```

Run it manually:

```bash
make relay-run
cloudflared tunnel --config ~/.cloudflared/config-herdr-remote.yml run
```

Then use this in the web app:

```text
wss://relay-mac.yourdomain.com
wss://relay-fedora.yourdomain.com
```

## Multiple Computers, One Page

Run one relay and one Cloudflare tunnel per computer. The web app connects to each relay URL directly and merges the agent lists in the browser.

Use distinct public hostnames, for example:

```text
wss://relay-mac.150283.xyz
wss://relay-fedora.150283.xyz
```

Each hostname should point at the tunnel for that computer. Do not run Mac and Fedora as replicas of the same Cloudflare tunnel if they serve different local relays; Cloudflare may send a WebSocket to either connector for that tunnel.

In the web app Settings, add both relay URLs. If both computers use the same `HERDR_RELAY_TOKEN`, enter the same token for both entries.

## macOS Background Service

For day-to-day use, prefer the LaunchAgent service over two manual terminals. It runs the relay and named Cloudflare tunnel together.

Prerequisite: create `~/.cloudflared/config-herdr-remote.yml` as shown above.

Install and start:

```bash
make service-install
```

The installer:

- creates `relay/.env` if it does not exist
- generates `HERDR_RELAY_TOKEN`
- writes `~/Library/LaunchAgents/com.herdr-remote.service.plist`
- starts `relay/herdr-remote-service.sh` through launchd

Useful commands:

```bash
make web-deploy
make service-status
make service-logs
make service-uninstall
```

Read the token for the web app:

```bash
sed -n 's/^HERDR_RELAY_TOKEN=//p' relay/.env
```

The service starts at login and launchd restarts it if it exits. Cloudflared handles normal sleep and network reconnects. If the laptop is powered off, the relay is unavailable until the Mac boots and the user logs in.

## Fedora/Linux Background Service

Install `cloudflared` first, then create the same named tunnel config shown above at `~/.cloudflared/config-herdr-remote.yml`. Cloudflare publishes Linux packages and RPM downloads for `cloudflared`.

Install and start a user systemd service:

```bash
make linux-service-install
```

Useful commands:

```bash
make linux-service-status
make linux-service-logs
make linux-service-uninstall
```

The Linux service runs `relay/herdr-remote-service.sh`, which starts both the relay and `cloudflared`. It uses `relay/.env` for `HERDR_RELAY_PORT`, `HERDR_RELAY_TOKEN`, and `CLOUDFLARED_CONFIG`.

## Architecture

```
        Web app
       /       \
 WebSocket   WebSocket
     │           │
 Mac tunnel  Fedora tunnel
     │           │
 Mac relay   Fedora relay
     │           │
 Mac herdr   Fedora herdr
```

## Token Auth

Enable relay auth with:

```bash
export HERDR_RELAY_TOKEN="$(openssl rand -hex 16)"
make relay-run
```

For the launchd service, set or read the token in `relay/.env`.

## herdr Plugin Hook

The relay polls local `herdr` every few seconds. For faster blocked-agent updates, link the local plugin hook on each computer:

```bash
make relay-plugin
```

The plugin sends local agent-status events to the local relay over UDP on `127.0.0.1:8376`. It does not expose another network service and does not connect to other computers.

## Requirements

- Python 3.10+
- [uv](https://docs.astral.sh/uv/)
- `cloudflared` for remote access
- herdr 0.7+
