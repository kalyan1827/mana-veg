export default {
  fetch(request, env) {
    const { pathname } = new URL(request.url);
    return pathname.startsWith('/api/') ? env.BACKEND.fetch(request) : env.ASSETS.fetch(request);
  }
};
