export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      const response = await env.BACKEND.fetch(request);
      if (response.status === 404 && request.method === 'GET') {
        const match = /^\/api\/photos\/([a-z0-9-]+?)(?:-(?:250g|500g|1kg))?$/.exec(url.pathname);
        if (match) {
          const asset = await env.ASSETS.fetch(new Request(new URL('/photos/' + match[1] + '.jpg', url), request));
          if (asset.ok) return asset;
        }
      }
      return response;
    }
    return env.ASSETS.fetch(request);
  }
};
