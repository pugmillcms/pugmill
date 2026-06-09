/**
 * SSRF guard for admin-configured outbound URLs (e.g. webhooks).
 *
 * Validates that a URL is http(s) and that the host does NOT resolve to a
 * loopback, private, link-local, or otherwise reserved address — the ranges an
 * attacker would target to reach cloud metadata (169.254.169.254), internal
 * services, or localhost.
 *
 * Note on DNS rebinding: we resolve and check here, but Node's fetch re-resolves
 * at request time, so a hostile DNS server could return a public IP now and a
 * private one later. Blocking at config time + dispatch time shrinks the window;
 * pinning the resolved IP would close it fully and is a reasonable follow-up.
 */
import { lookup } from "dns/promises";
import net from "net";

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const o = Number(p);
    if (!Number.isInteger(o) || o < 0 || o > 255) return null;
    n = (n << 8) | o;
  }
  return n >>> 0;
}

function inV4Cidr(ipInt: number, base: string, maskBits: number): boolean {
  const baseInt = ipv4ToInt(base);
  if (baseInt === null) return false;
  const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

function isBlockedV4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return true; // unparseable → treat as unsafe
  return (
    inV4Cidr(n, "0.0.0.0", 8) ||        // "this" network
    inV4Cidr(n, "10.0.0.0", 8) ||       // private
    inV4Cidr(n, "100.64.0.0", 10) ||    // CGNAT
    inV4Cidr(n, "127.0.0.0", 8) ||      // loopback
    inV4Cidr(n, "169.254.0.0", 16) ||   // link-local (incl. cloud metadata)
    inV4Cidr(n, "172.16.0.0", 12) ||    // private
    inV4Cidr(n, "192.0.0.0", 24) ||     // IETF protocol assignments
    inV4Cidr(n, "192.0.2.0", 24) ||     // TEST-NET-1
    inV4Cidr(n, "192.168.0.0", 16) ||   // private
    inV4Cidr(n, "198.18.0.0", 15) ||    // benchmarking
    inV4Cidr(n, "198.51.100.0", 24) ||  // TEST-NET-2
    inV4Cidr(n, "203.0.113.0", 24) ||   // TEST-NET-3
    inV4Cidr(n, "224.0.0.0", 4) ||      // multicast
    inV4Cidr(n, "240.0.0.0", 4)         // reserved (incl. 255.255.255.255)
  );
}

function isBlockedV6(ip: string): boolean {
  const addr = ip.toLowerCase().split("%")[0]; // strip zone id
  if (addr === "::1" || addr === "::") return true; // loopback / unspecified
  // IPv4-mapped (::ffff:a.b.c.d) — check the embedded v4.
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedV4(mapped[1]);
  if (addr.startsWith("fe80")) return true; // link-local
  if (addr.startsWith("fc") || addr.startsWith("fd")) return true; // unique local (fc00::/7)
  return false;
}

/** True if the literal IP is in a private / loopback / reserved range. */
export function isBlockedAddress(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) return isBlockedV4(ip);
  if (kind === 6) return isBlockedV6(ip);
  return true; // not an IP literal → unsafe to treat as routable
}

/**
 * Resolve and validate an outbound URL. Throws a descriptive Error if the URL
 * is not an http(s) URL pointing at a public host. Returns the parsed URL.
 */
export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http(s) URLs are allowed");
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  // Obvious local names that may resolve via hosts file / internal DNS.
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("URL host is not allowed");
  }

  // If it's a literal IP, check it directly (no DNS).
  if (net.isIP(host)) {
    if (isBlockedAddress(host)) {
      throw new Error("URL resolves to a private or reserved address");
    }
    return url;
  }

  // Resolve the hostname and reject if ANY returned address is blocked.
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new Error("Could not resolve URL host");
  }
  if (addrs.length === 0 || addrs.some((a) => isBlockedAddress(a.address))) {
    throw new Error("URL resolves to a private or reserved address");
  }

  return url;
}
