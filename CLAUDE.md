# EV Monitor Dashboard

Next.js 15 (App Router) + TypeScript + Tailwind CSS

## Stack
- Frontend: Next.js 15, React, TypeScript
- Styling: Tailwind + custom CSS variables in globals.css
- State: React Context (AppProviders)
- Data: Mock data in lib/mockData.ts (no backend yet)
- Future: WebSocket from Node.js MQTT bridge, MongoDB

## Pages
- / → Fleet Overview (200 stations grid/table)
- /station/[id] → Station Detail (6 tabs)
- /alerts → Alert Center
- /config → Station Config (add/edit stations)
- /settings → Thresholds + Telegram config

## Key conventions
- All colors use CSS variables from globals.css (--bg-surface, --ok-text etc.)
- Font: monospace throughout (var(--font-mono))
- Design tokens defined in app/globals.css :root
- No external component library — custom utility classes (.card, .btn, .badge, .input)
- 'use client' on all interactive pages/components

## When backend is ready
- Replace MOCK_* in lib/mockData.ts with real API calls
- Set NEXT_PUBLIC_WS_URL in .env.local to enable real WebSocket
- useWebSocket hook in lib/hooks/useWebSocket.ts handles connection