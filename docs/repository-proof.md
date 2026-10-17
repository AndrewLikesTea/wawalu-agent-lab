# Homepage repository proof

The static last-verified example is transcribed from the public historical
`src/build-stamp.js` at commit
`a1dc0a2dd45b24f8c114dfabed2a31f095f75557`.
That stamp records build `28b2398ff49c1026182305c85b8a2ed715069ab6`,
built at `2026-09-25T09:08:40.330Z`, and a commit subject ending in
`(#2547)`. The canonical repository decision in `src/seed-records.js`
cites that same pull request. Inspect locally with:

```sh
git show a1dc0a2dd45b24f8c114dfabed2a31f095f75557:src/build-stamp.js
git show --no-patch 28b2398ff49c1026182305c85b8a2ed715069ab6
```

This proves a decision reached a recorded build. It does not establish
production deployment of that historical build, elapsed delivery time,
customer adoption, or savings. The homepage links the immutable stamp, not
the moving main branch.

Current proof additionally requires a valid current build stamp, exactly one
canonical decision citing its merged PR, and a healthy /healthz response with
the identical commit SHA. Most builds do not merge one of the three canonical
decisions; those correctly retain historical proof without a current claim.
A five-second deadline and per-document request identity protect failure and
retry states. Only status text is live-announced; historical proof stays static.
