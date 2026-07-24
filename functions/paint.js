// Bare /paint lands on the app; assets resolve relative to /paint/.
export function onRequest({ request }) {
  return Response.redirect(new URL("/paint/", request.url).toString(), 301);
}
