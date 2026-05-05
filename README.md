# EV-Dashboard3

EV Charger Station Monitoring Dashboard
Next.js 16 (App Router) + TypeScript + Tailwind CSS + MQTT + MongoDB + WebSocket

## Stack

- **Frontend**: Next.js 16, React 19, TypeScript, Tailwind CSS v4
- **Backend**: Node.js (tsx), MQTT, MongoDB, WebSocket (`ws`)
- **Database**: MongoDB (multiple databases — see Architecture)
- **MQTT broker**: subscribed by backend, broadcasted via WebSocket

## Architecture

```
Stations (MQTT) → Backend (server/) → MongoDB
                       ↓
                   WebSocket (port 4100)
                       ↓
                   Frontend (Next.js, port 3000)
                       ↑
              REST API (/api/*) reads MongoDB
```

### MongoDB databases

| Database     | Purpose                                        |
|--------------|------------------------------------------------|
| `Station`    | Station configs, alerts, device/script status |
| `Heartbeat`  | OCPP heartbeat history (Node-RED)              |
| `PowerModule`| Power module data (Node-RED)                   |
| `meter`      | Meter readings (Node-RED)                      |
| `Router`     | Router heartbeat (Node-RED)                    |
| `StatePLC`   | Filtered PLC payloads (changed values only)    |
| `PlcDatabase`| Legacy PLC data (Node-RED, old format)         |

## Setup

```bash
# Install dependencies
npm install

# Copy env template and fill in values
cp .env.example .env.local
# Edit .env.local with your MongoDB / MQTT connection strings
```

## Running

```bash
# Terminal 1: Backend (MQTT subscriber + WebSocket server)
npm run server

# Terminal 2: Frontend (Next.js dev)
npm run dev
```

Open `http://localhost:3000`

## Production deploy

```bash
# Build frontend
npm run build

# Start production servers
npm run server   # Backend
npm run start    # Frontend (port 3000)
```

For long-running deploy use a process manager like `pm2`:

```bash
pm2 start "npm run server" --name ev-backend
pm2 start "npm run start"  --name ev-frontend
pm2 save
pm2 startup
```

## Adding a station

1. Open `/config` in the dashboard
2. Click **+ Add Station**
3. Fill in MQTT topics, MongoDB collection names, fan brand, expected PM per head
4. Click **Add Station** — backend auto-picks up within 10s, no restart needed

## Pages

| Route | Description |
|-------|-------------|
| `/`                | Fleet Overview — all stations |
| `/station/[id]`    | Station Detail — 7 tabs |
| `/overview/[type]` | Per-type overview across all stations |
| `/alerts`          | Alert center |
| `/config`          | Station configuration |
| `/settings`        | Thresholds + Telegram (disabled until v2) |

## License

Private / proprietary.
