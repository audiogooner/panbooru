# Panbooru

Panbooru is a single-owner gallery. The application keeps SQLite and media on a data volume and the encryption key on a separate secret mount. Put an HTTPS reverse proxy in front before exposing it beyond the host.

## Run locally

1. Create a data directory and a secret directory. The secret directory must be a different mount from the data directory so a database copy does not include the master key. The container user is uid 1001 and must be able to write the data directory.
2. Start the app bound to loopback. Compose publishes `127.0.0.1:3000` only.

```sh
docker compose up --build
```

The service reads:

- `PANBOORU_DATA_DIR` — library database, originals, derivatives, cache, temporary files, and backup staging
- `PANBOORU_SECRET_PATH` — 32-byte master key. The process creates this file on a fresh install. It does not create a new key when saved Gelbooru credentials already exist.

3. Terminate TLS in a proxy on the host and forward it to `127.0.0.1:3000`. The proxy is not part of the Compose file. A Caddy site block is enough:

```caddy
panbooru.example {
	reverse_proxy 127.0.0.1:3000
}
```

Disable request-body and URL logging on the proxy for `/api/settings/gelbooru/validate`. Upstream credential parameters are redacted in application logs, and the proxy should not record them either.

4. Read the bootstrap token from the data volume at `bootstrap.token`, open `/setup`, and create the owner password. The token file is removed when setup succeeds. There is no password-recovery page.
5. Sign in and enter the Gelbooru user id and API key under Settings, then press Validate. The key is stored as ciphertext. The settings page and the session response do not return it.
6. Search, open a post, and favorite it. The original download continues on the server. When it is ready, the favorites page serves the local file.
7. Create a backup from an authenticated `POST /api/backups`. The bundle is a SQLite snapshot, the retained originals, and a manifest of schema version, application version, and sha256 hashes. Derivatives and cache are omitted. The master key is not in the bundle.

`/data/backups` is staging on the same volume as the live library. It is not the only copy. Copy a completed backup, and the secret mount, to storage that is not the live host volume before treating the backup as kept.

Restore a verified bundle into an empty data directory, then point the app at that directory and at the original secret mount. A missing or wrong key still allows owner login and local originals. Gelbooru reports that the master key is unavailable until the owner validates a new key. The process does not write a new key over existing ciphertext.

The discussed 5–50 GB library is a planning range, not a measured capacity. Give the data volume the space and permissions the library actually needs. This build does not publish a latency or recovery-time target.

## Fail closed

`GET /health` answers without paths or secrets. `GET /api/ready` is authenticated and reports whether the database, key, and storage are usable, without their locations.

On startup the process refuses a database whose schema version is newer than this build. Take a backup before upgrading. An older image is not expected to open a database written by a newer one.

A full disk leaves the original unready. `SIGTERM` stops new download claims and leaves an in-flight claim recoverable after the lease expires.

## Development

```sh
npm install
npm run dev
npm run test:unit -- --run
npx playwright test src/routes/foundation.e2e.ts src/routes/library.e2e.ts src/routes/viewer.e2e.ts src/routes/a11y.e2e.ts
```

Copy `.env.example` to `.env` for local paths. Do not commit `.env`, `data/`, key files, or Playwright `test-results`.
