import { app, net, protocol } from "electron";
import path from "path";
import { pathToFileURL } from "url";
import electronIsDev from "electron-is-dev";
import { hasImageAccess } from "./path-access";
import { contentSecurityPolicy, resolveAssetPath } from "./security";

protocol.registerSchemesAsPrivileged([{ scheme: "upscayl", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

export const registerProtocols = () => {
  protocol.handle("upscayl", async request => {
    try {
      const url = new URL(request.url);
      const trustedOrigin = electronIsDev ? "http://localhost:8000" : "upscayl://app";
      const initiator = (request as Request & { initiatorOrigin?: string }).initiatorOrigin;
      if (initiator && initiator !== trustedOrigin) return new Response("Forbidden", { status: 403 });
      let file: string;
      if (url.hostname === "image") {
        file = decodeURIComponent(url.pathname.slice(1));
        if (!hasImageAccess(file)) return new Response("Forbidden", { status: 403 });
      } else if (url.hostname === "app" || url.hostname === "assets") {
        const root = path.join(app.getAppPath(), "renderer", electronIsDev && url.hostname === "assets" ? "public" : "out");
        file = resolveAssetPath(root, url.pathname === "/" ? "/index.html" : url.pathname);
      } else return new Response("Not found", { status: 404 });
      const response = await net.fetch(pathToFileURL(file).toString());
      const headers = new Headers(response.headers);
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("Access-Control-Allow-Origin", trustedOrigin);
      if (url.hostname === "app") headers.set("Content-Security-Policy", contentSecurityPolicy(false));
      return new Response(response.body, { status: response.status, headers });
    } catch { return new Response("Not found", { status: 404 }); }
  });
};
