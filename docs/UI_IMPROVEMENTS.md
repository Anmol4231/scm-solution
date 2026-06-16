# UI / UX Improvements

Extensions to the existing SCM Solution frontend and chat assistant.

**Note:** The heavy visual redesign (grouped collapsible sidebar, StatWidget cards, health-card classes) was reverted in favor of the simpler original layout while keeping all features. See [OFFLINE_FIRST.md](./OFFLINE_FIRST.md) for PWA/offline support.

## SCM Assistant (Task 1)

### Root cause of "unknown" label
The backend `aiResponseLayer` prefixed replies with `**unknown**` when intent detection did not match a pattern. The UI stripped markdown but left the word `unknown` visible.

### Fixes
- Renamed fallback intent from `unknown` → `general`
- Removed intent label from user-visible replies for general/unknown cases
- Structured API response with `assistant`, `messages[]` (`sender`, `message`, `timestamp`, `avatar`, `role`)
- `GET /api/chat/profile` — assistant identity + welcome message
- Frontend: profile header, Stethoscope avatar, timestamps, improved bubbles, 8 quick actions
- `safeText()` prevents displaying `unknown`, `undefined`, or `null`

## Dashboard (Task 2)
- `GET /dashboard/facility` returns `widgets` object with KPI counts
- Facility dashboard uses `StatWidget` cards (medicines, patients, staff, dispensing, low stock, expiry, shipments, transfers, returns)
- Shared `.health-card` and `.health-table` styles

## Sidebar
- `AppSidebar` with grouped sections: Operations, Inventory, Administration
- Collapsible desktop sidebar
- Mobile overlay menu

## Medicine detail
- Recharts bar charts for daily/weekly/monthly inbound and outbound
- Existing batch table and overview retained

## Admin command center
- Shipment status widget
- Pending sync (non-reporting facilities)
- Global activity feed from `recentActivity` in admin dashboard API

## Theme
- Healthcare blue / white / gray palette via existing `medflow` scale and status utility classes
