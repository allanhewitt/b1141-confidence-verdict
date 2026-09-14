const PORTALS = {
  b1141: "http://ai3pbfgh23bz6pqvml37qngu.167.233.132.208.sslip.io",
};

export function portalReturnUrl(search = window.location.search) {
  const portal = new URLSearchParams(search).get("gdl_portal");
  return PORTALS[portal] || null;
}

export function returnToPortal(search = window.location.search) {
  const url = portalReturnUrl(search);
  if (url) window.location.assign(url);
}
