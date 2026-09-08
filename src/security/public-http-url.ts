import { lookup } from "node:dns/promises";
import { isIP, isIPv4, isIPv6 } from "node:net";

const BLOCKED_HOSTNAME_SUFFIXES = [".localhost", ".local", ".internal", ".intranet", ".lan"];

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
]);

export type DnsLookupFn = typeof lookup;

/**
 * Reject non-public image URLs before they are forwarded to SPIO
 * Blocks loopback, private, link-local, and similar targets (SSRF)
 */
export async function assertPublicHttpUrl(
  rawUrl: string,
  dnsLookup: DnsLookupFn = lookup,
): Promise<void> {
  let parsed: URL;

  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Only http and https URLs are allowed: ${rawUrl}`);
  }

  if (parsed.username || parsed.password) {
    throw new Error(`URLs with embedded credentials are not allowed: ${rawUrl}`);
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();

  if (!hostname) {
    throw new Error(`URL hostname is missing: ${rawUrl}`);
  }

  if (isBlockedHostname(hostname)) {
    throw new Error(`URL host is not allowed (localhost/internal): ${rawUrl}`);
  }

  const ipVersion = isIP(hostname);

  if (ipVersion !== 0) {
    if (isNonPublicIp(hostname)) {
      throw new Error(`URL points to a non-public IP address: ${rawUrl}`);
    }

    return;
  }

  let addresses: Array<{ address: string }>;

  try {
    addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error(`Could not resolve URL host: ${rawUrl}`);
  }

  if (addresses.length === 0) {
    throw new Error(`Could not resolve URL host: ${rawUrl}`);
  }

  for (const { address } of addresses) {
    if (isNonPublicIp(address)) {
      throw new Error(`URL resolves to a non-public IP address: ${rawUrl}`);
    }
  }
}

export async function assertPublicHttpUrls(
  urls: string[],
  dnsLookup: DnsLookupFn = lookup,
): Promise<void> {
  for (const url of urls) {
    await assertPublicHttpUrl(url, dnsLookup);
  }
}

function isBlockedHostname(hostname: string): boolean {
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return true;
  }

  return BLOCKED_HOSTNAME_SUFFIXES.some(
    (suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix),
  );
}

function isNonPublicIp(ip: string): boolean {
  if (isIPv4(ip)) {
    return isNonPublicIpv4(ip);
  }

  if (isIPv6(ip)) {
    return isNonPublicIpv6(ip);
  }

  return true;
}

function isNonPublicIpv4(ip: string): boolean {
  const parts = ip.split(".").map((part) => Number(part));

  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return true;
  }

  const [a, b] = parts;

  // 0.0.0.0/8
  if (a === 0) {
    return true;
  }

  // 10.0.0.0/8
  if (a === 10) {
    return true;
  }

  // 127.0.0.0/8
  if (a === 127) {
    return true;
  }

  // 169.254.0.0/16 link-local (includes cloud metadata)
  if (a === 169 && b === 254) {
    return true;
  }

  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }

  // 192.168.0.0/16
  if (a === 192 && b === 168) {
    return true;
  }

  // 100.64.0.0/10 CGNAT
  if (a === 100 && b >= 64 && b <= 127) {
    return true;
  }

  // 192.0.0.0/24 IETF protocol assignments
  if (a === 192 && b === 0 && parts[2] === 0) {
    return true;
  }

  // 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24 documentation
  if (a === 192 && b === 0 && parts[2] === 2) {
    return true;
  }

  if (a === 198 && b === 51 && parts[2] === 100) {
    return true;
  }

  if (a === 203 && b === 0 && parts[2] === 113) {
    return true;
  }

  // 224.0.0.0/4 multicast, 240.0.0.0/4 reserved
  if (a >= 224) {
    return true;
  }

  return false;
}

function isNonPublicIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();

  if (normalized === "::" || normalized === "::1") {
    return true;
  }

  // IPv4-mapped IPv6 (::ffff:a.b.c.d)
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);

    if (isIPv4(mapped)) {
      return isNonPublicIpv4(mapped);
    }
  }

  // Expand enough to check prefixes via first hextets
  const full = expandIpv6(normalized);
  const first = Number.parseInt(full[0], 16);
  const second = Number.parseInt(full[1], 16);

  // fe80::/10 link-local
  if ((first & 0xffc0) === 0xfe80) {
    return true;
  }

  // fc00::/7 unique local
  if ((first & 0xfe00) === 0xfc00) {
    return true;
  }

  // ff00::/8 multicast
  if ((first & 0xff00) === 0xff00) {
    return true;
  }

  // 2001:db8::/32 documentation
  if (first === 0x2001 && second === 0xdb8) {
    return true;
  }

  return false;
}

function expandIpv6(ip: string): string[] {
  const [head, tail] = ip.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  const missing = 8 - (headParts.length + tailParts.length);
  const zeros = Array.from({ length: Math.max(missing, 0) }, () => "0");
  const parts = [...headParts, ...zeros, ...tailParts].map((part) => part || "0");

  while (parts.length < 8) {
    parts.push("0");
  }

  return parts.slice(0, 8).map((part) => part.padStart(4, "0"));
}
