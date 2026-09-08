import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertPublicHttpUrl,
  assertPublicHttpUrls,
  type DnsLookupFn,
} from "../src/security/public-http-url.js";

/**
 * SSRF guard for outbound image URLs
 * These tests cover protocol validation, credential stripping, hostname blocklists,
 * literal private/reserved IPs, IPv6 ranges, and DNS rebinding via injected lookup
 */

function mockDnsLookup(
  resolver: (
    hostname: string,
  ) => Array<{ address: string; family?: number }> | Promise<Array<{ address: string; family?: number }>>,
): DnsLookupFn {
  return (async (hostname: string) => resolver(hostname)) as DnsLookupFn;
}

describe("assertPublicHttpUrl — protocol and shape", () => {
  it("rejects malformed URLs", async () => {
    await assert.rejects(
      () => assertPublicHttpUrl("not-a-url"),
      /Invalid URL/,
    );
  });

  it("rejects non-http(s) schemes (file, ftp, javascript)", async () => {
    await assert.rejects(
      () => assertPublicHttpUrl("file:///etc/passwd"),
      /Only http and https/,
    );
    await assert.rejects(
      () => assertPublicHttpUrl("ftp://example.com/image.jpg"),
      /Only http and https/,
    );
    await assert.rejects(
      () => assertPublicHttpUrl("javascript:alert(1)"),
      /Only http and https/,
    );
  });

  it("rejects URLs with embedded credentials", async () => {
    await assert.rejects(
      () => assertPublicHttpUrl("https://user:secret@8.8.8.8/photo.jpg"),
      /embedded credentials/,
    );
  });

  it("accepts public literal IPv4 without DNS lookup", async () => {
    await assert.doesNotReject(() => assertPublicHttpUrl("https://8.8.8.8/image.png"));
    await assert.doesNotReject(() => assertPublicHttpUrl("http://1.1.1.1/a.jpg"));
  });
});

describe("assertPublicHttpUrl — blocked hostnames", () => {
  const blocked = [
    "http://localhost/secret.jpg",
    "https://LOCALHOST/x",
    "http://metadata.google.internal/latest/meta-data/",
    "http://metadata/v1/",
    "http://app.localhost/img.png",
    "http://printer.local/logo.png",
    "http://db.internal/backup.sql",
    "http://share.intranet/file.jpg",
    "http://nas.lan/photo.jpg",
  ];

  for (const url of blocked) {
    it(`blocks internal hostname: ${url}`, async () => {
      await assert.rejects(
        () => assertPublicHttpUrl(url),
        /not allowed \(localhost\/internal\)/,
      );
    });
  }
});

describe("assertPublicHttpUrl — private and reserved IPv4 literals", () => {
  const privateIpv4 = [
    "http://127.0.0.1/admin",
    "http://127.255.255.254/x",
    "http://10.0.0.1/internal",
    "http://172.16.0.1/internal",
    "http://172.31.255.255/internal",
    "http://192.168.1.100/cam",
    "http://169.254.169.254/latest/meta-data/",
    "http://0.0.0.0/",
    "http://100.64.0.1/cgnat",
    "http://192.0.0.1/ietf",
    "http://192.0.2.1/docs",
    "http://198.51.100.1/docs",
    "http://203.0.113.1/docs",
    "http://224.0.0.1/multicast",
    "http://240.0.0.1/reserved",
  ];

  for (const url of privateIpv4) {
    it(`blocks non-public IPv4: ${url}`, async () => {
      await assert.rejects(
        () => assertPublicHttpUrl(url),
        /non-public IP/,
      );
    });
  }
});

describe("assertPublicHttpUrl — private and reserved IPv6 literals", () => {
  const privateIpv6 = [
    "http://[::1]/loopback",
    "http://[::]/unspecified",
    "http://[fe80::1]/link-local",
    "http://[fc00::1]/ula",
    "http://[ff02::1]/multicast",
    "http://[2001:db8::1]/documentation",
    "http://[::ffff:127.0.0.1]/v4-mapped-loopback",
    "http://[::ffff:192.168.0.1]/v4-mapped-private",
  ];

  for (const url of privateIpv6) {
    it(`blocks non-public IPv6: ${url}`, async () => {
      await assert.rejects(
        () => assertPublicHttpUrl(url),
        /non-public IP/,
      );
    });
  }

  it("accepts a public IPv6 literal", async () => {
    await assert.doesNotReject(() =>
      assertPublicHttpUrl("https://[2001:4860:4860::8888]/dns.png"),
    );
  });
});

describe("assertPublicHttpUrl — DNS resolution (injected lookup)", () => {
  it("rejects hostnames that resolve only to private IPv4", async () => {
    const lookup = mockDnsLookup(() => [{ address: "10.0.0.50", family: 4 }]);

    await assert.rejects(
      () => assertPublicHttpUrl("https://rebind.example.com/image.jpg", lookup),
      /resolves to a non-public IP/,
    );
  });

  it("rejects when any resolved address is private (mixed A records)", async () => {
    const lookup = mockDnsLookup(() => [
      { address: "93.184.216.34", family: 4 },
      { address: "192.168.1.1", family: 4 },
    ]);

    await assert.rejects(
      () => assertPublicHttpUrl("https://mixed-dns.example.com/a.jpg", lookup),
      /resolves to a non-public IP/,
    );
  });

  it("accepts hostnames that resolve to public IPv4", async () => {
    const lookup = mockDnsLookup(() => [{ address: "93.184.216.34", family: 4 }]);

    await assert.doesNotReject(() =>
      assertPublicHttpUrl("https://cdn.example.com/hero.webp", lookup),
    );
  });

  it("rejects unresolvable hostnames", async () => {
    const lookup = mockDnsLookup(async () => {
      throw new Error("ENOTFOUND");
    });

    await assert.rejects(
      () => assertPublicHttpUrl("https://does-not-exist.invalid/photo.jpg", lookup),
      /Could not resolve URL host/,
    );
  });

  it("rejects when DNS returns no addresses", async () => {
    const lookup = mockDnsLookup(() => []);

    await assert.rejects(
      () => assertPublicHttpUrl("https://empty-dns.example.com/x.jpg", lookup),
      /Could not resolve URL host/,
    );
  });

  it("rejects hostnames resolving to link-local IPv6", async () => {
    const lookup = mockDnsLookup(() => [{ address: "fe80::1", family: 6 }]);

    await assert.rejects(
      () => assertPublicHttpUrl("https://ipv6-rebind.example.com/pic.jpg", lookup),
      /resolves to a non-public IP/,
    );
  });
});

describe("assertPublicHttpUrls", () => {
  it("validates every URL in order and stops at the first violation", async () => {
    await assert.rejects(
      () =>
        assertPublicHttpUrls([
          "https://8.8.8.8/ok.jpg",
          "http://127.0.0.1/bad.jpg",
        ]),
      /non-public IP/,
    );
  });

  it("accepts a list of public literal URLs", async () => {
    await assert.doesNotReject(() =>
      assertPublicHttpUrls([
        "https://8.8.8.8/a.jpg",
        "https://1.1.1.1/b.jpg",
      ]),
    );
  });
});
