# PentaBlocks Auth and Cloud Save Setup

## 1. Create PostgreSQL Database

Example:

```sql
CREATE DATABASE pentablocks;
```

## 2. Configure Environment

Copy `.env.example` to `.env` and set:

- `DATABASE_URL`
- `APP_ORIGIN` (example: `http://localhost:3020`)
- `VITE_API_BASE_URL` (example: `http://localhost:8787`)

For Google login:

- `VITE_GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_ID` (same value as above)

## 3. Start Frontend + API

Terminal 1:

```bash
npm run dev
```

Terminal 2:

```bash
npm run server:dev
```

On first API boot, schema is created automatically from `server/sql/init.sql`.

## 4. What Gets Synced

- completed levels
- best times
- player stats
- last played level

Local device storage remains active as fallback.

## 5. API Endpoints

- `GET /api/health`
- `GET /api/auth/me`
- `POST /api/auth/guest`
- `POST /api/auth/email/register`
- `POST /api/auth/email/login`
- `POST /api/auth/google`
- `POST /api/auth/logout`
- `GET /api/progress`
- `PUT /api/progress`
