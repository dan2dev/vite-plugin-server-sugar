import { API_PREFIX, DEFAULT_PATHNAME_BASE, WS_API_PREFIX } from "./constants";

export interface EndpointPaths {
  apiPrefix: string;
  wsPrefix: string;
}

function normalizePathnameBase(pathnameBase: string): string {
  const trimmed = pathnameBase.trim();
  if (!trimmed) {
    throw new Error("[server-build] pathnameBase must not be empty.");
  }
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed)) {
    throw new Error(
      "[server-build] pathnameBase must be a pathname, not a URL.",
    );
  }
  if (trimmed.includes("?") || trimmed.includes("#")) {
    throw new Error(
      "[server-build] pathnameBase must not include a query string or hash.",
    );
  }

  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const withoutTrailingSlash = withLeadingSlash.replace(/\/+$/, "");
  if (withoutTrailingSlash === "") {
    throw new Error(
      "[server-build] pathnameBase must include at least one path segment.",
    );
  }

  return withoutTrailingSlash;
}

export function createEndpointPaths(
  pathnameBase = DEFAULT_PATHNAME_BASE,
): EndpointPaths {
  const normalizedBase = normalizePathnameBase(pathnameBase);

  if (normalizedBase === DEFAULT_PATHNAME_BASE) {
    return {
      apiPrefix: API_PREFIX,
      wsPrefix: WS_API_PREFIX,
    };
  }

  return {
    apiPrefix: `${normalizedBase}/`,
    wsPrefix: `${normalizedBase}-ws/`,
  };
}

export function endpointUrl(prefix: string, endpoint: string): string {
  return prefix + endpoint.split("/").map(encodeURIComponent).join("/");
}
