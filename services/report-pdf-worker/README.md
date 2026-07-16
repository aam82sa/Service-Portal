# report-pdf-worker

High-fidelity PDF rendering for the reporting module (Reporting Branch 3). A
small containerized HTTP service that runs **headless Chromium (Playwright)** to
turn a report's data into a print-quality PDF — the same visual language as the
Insights dashboard, and, unlike the programmatic fallback, full Arabic/RTL.

It is an **enhancement, not a hard dependency**: when the worker is not
configured, `generate-report` falls back to a programmatic `pdf-lib` table
(`supabase/functions/generate-report/pdf.ts`), so the module works without it.

## Contract

| Method | Path      | Notes |
| ------ | --------- | ----- |
| `GET`  | `/health` | Liveness probe → `200 ok` |
| `POST` | `/`       | Requires header `x-worker-secret`. Body → PDF bytes |

Request body (JSON):

```jsonc
{
  "title": "SLA compliance",
  "subtitle": "Jan–Jun 2026",       // optional
  "columns": ["dept", "met", "breached"],
  "rows": [{ "dept": "IT", "met": 98, "breached": 2 }],
  "generatedAt": "2026-07-16T20:00:00Z", // optional; defaults to now
  "direction": "ltr"                 // optional; "rtl" for Arabic-first reports
}
```

Response: `200 application/pdf` (the rendered document) or `4xx/5xx` with a
plain-text reason. Cell values are HTML-escaped in `template.ts` before they
reach the page, so report data can never inject markup.

## Environment

| Var | Required | Default | Purpose |
| --- | -------- | ------- | ------- |
| `REPORT_PDF_WORKER_SECRET` | yes | — | Shared secret; requests without a matching `x-worker-secret` header are rejected |
| `PORT` | no | `8080` | Listen port |

`generate-report` calls this worker only when **both** of these Supabase
secrets are set; otherwise it uses the pdf-lib fallback:

```bash
supabase secrets set \
  REPORT_PDF_WORKER_URL=https://<worker-host>/ \
  REPORT_PDF_WORKER_SECRET=<same-secret-as-worker>
```

## Build & run

```bash
docker build -t report-pdf-worker services/report-pdf-worker
docker run -p 8080:8080 -e REPORT_PDF_WORKER_SECRET=dev-secret report-pdf-worker
# smoke test
curl -s -X POST http://localhost:8080/ \
  -H 'x-worker-secret: dev-secret' -H 'content-type: application/json' \
  -d '{"title":"Demo","columns":["a"],"rows":[{"a":1}]}' -o demo.pdf
```

## Deploy target (INFRA — Ady)

Containerized; target **Google Cloud Run** or a small always-on VM.

**Data residency (ties to the W8 decision):** report bytes contain business
data, so host the worker **in-region for KSA** (e.g. `me-central1`). Set the
same secret on the worker and in Supabase (above). Cloud Run notes:

- min instances `1` avoids cold-start Chromium launches on the first report;
- generous request timeout (PDF render of a large report can take a few
  seconds); memory ≥ 1 GiB (Chromium);
- keep the service private and reachable only from Supabase Edge egress, and
  rely on the shared secret as the auth boundary.

Until the worker is hosted, nothing needs to change — the reporting module keeps
producing PDFs via the fallback.
