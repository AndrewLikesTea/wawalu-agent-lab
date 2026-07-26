# Stateless image export API

`POST /api/image/export/{format}` decodes an uploaded raster image, applies a
bounded set of edits through the Cloudflare Images binding, and returns the
encoded result. `format` is exactly `png` or `jpeg`.

The request is `multipart/form-data`:

- `file` (required): PNG, JPEG, GIF, or WebP input, at most 5 MB. The declared
  content type must agree with the file signature.
- `transformations` (optional): a JSON object with `width` and `height`
  (integers 1–4096), `fit` (`scale-down`, `contain`, `cover`, `crop`, or `pad`),
  `rotate` (0, 90, 180, or 270), and JPEG-only `quality` (1–100). Unknown keys
  are rejected.

A successful response is `200`, has `Content-Type: image/png` or `image/jpeg`,
is an attachment named `edited-image.png` or `edited-image.jpg`, and is marked
`Cache-Control: no-store`. Every response has `X-Request-Id`.

Errors use `{ "error": { "code", "message", "request_id", "fields"? } }`.
Malformed bodies are `400`, wrong methods `405`, oversized inputs `413`,
non-multipart bodies `415`, invalid image/edit requests `422`, and a missing
Images binding `503`.

The handler does not call D1, R2, the cache, or the filesystem. Input bytes,
transformation state, and encoded output exist only for the request lifetime.
The pipeline is a single ordered Images binding chain, so there is no partial
durable state on failure. Completion and processing failures are logged with
the request id, format, duration, and byte count; image bytes are never logged.

The binding is declared in `wrangler.toml`:

```toml
[images]
binding = "IMAGES"
```

This binding change has production effect when the reviewed pipeline deploys
it. It was not applied to live infrastructure manually.
