// labs.wawalu.org/paint/* proxies the paint-lab product, which auto-publishes
// to GitHub Pages on every merge to its main. The synthetic team ships to
// paint-lab; this function is how their work reaches labs.wawalu.org.
const UPSTREAM = "https://andrewlikestea.github.io/paint-lab";

export async function onRequest({ request, params }) {
  const url = new URL(request.url);
  const segments = Array.isArray(params.path) ? params.path.join("/") : (params.path ?? "");
  const upstream = await fetch(`${UPSTREAM}/${segments}${url.search}`, {
    headers: { "User-Agent": "labs-wawalu-paint-proxy" },
    redirect: "manual",
  });
  const headers = new Headers(upstream.headers);
  const location = headers.get("location");
  if (location) {
    headers.set("location", location.replace(UPSTREAM, `${url.origin}/paint`));
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
