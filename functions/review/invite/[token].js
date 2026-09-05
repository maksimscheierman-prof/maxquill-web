export const onRequest = async (context) => {
  const token = context.params.token;
  if (!token || typeof token !== "string" || !/^[a-f0-9]{32,128}$/i.test(token)) {
    return Response.redirect(new URL("/invite.html", context.request.url), 302);
  }
  return Response.redirect(new URL(`/invite.html?token=${encodeURIComponent(token)}`, context.request.url), 302);
};
