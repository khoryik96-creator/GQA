"use strict";

function canonicalOrigin(raw) {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.pathname !== "/") return null;
    if (!url.hostname) return null;
    return url.origin;
  } catch { return null; }
}

function allowedTarget(target, allowList) {
  const candidate = canonicalOrigin(target);
  if (!candidate) return false;
  return allowList.split(",").some(item => item.trim() && canonicalOrigin(item.trim()) === candidate);
}

module.exports = { canonicalOrigin, allowedTarget };
