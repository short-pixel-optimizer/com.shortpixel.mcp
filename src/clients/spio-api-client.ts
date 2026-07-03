import { getPluginVersion, getSpioApiUrl } from "../config/environment.js";
import { maskApiKey, requestLogger } from "../logging/request-logger.js";

export type OptimizeOptions = {
  lossy?: number;
  wait?: number;
  upscale?: number;
  resize?: number;
  convertto?: string;
  resize_width?: number;
  resize_height?: number;
  cmyk2rgb?: number;
  keep_exif?: number;
  bg_remove?: string | number;
  refresh?: number;
  paramlist?: Array<Record<string, unknown>>;
  returndatalist?: unknown[];
};

export type SpioApiClientOptions = {
  apiKey: string;
  baseUrl?: string;
  pluginVersion?: string;
};

export class SpioApiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly pluginVersion: string;
  private readonly retryMaxAttempts = 4;
  private readonly retryInitialDelayMs = 2_000;
  private readonly retryMaxDelayMs = 30_000;

  constructor(options: SpioApiClientOptions) {
    if (!options.apiKey) {
      throw new Error("ShortPixel API key is required");
    }

    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? getSpioApiUrl()).replace(/\/$/, "");
    this.pluginVersion = options.pluginVersion ?? getPluginVersion();
  }

  async optimizeUrls(
    urls: string[],
    options: OptimizeOptions = {},
  ): Promise<Record<string, unknown>[]> {
    if (urls.length === 0) {
      throw new Error("At least one image URL is required");
    }

    const payload = {
      key: this.apiKey,
      plugin_version: this.pluginVersion,
      lossy: 1,
      wait: 20,
      urllist: urls,
      ...options,
    };

    requestLogger.info("spio_request", {
      endpoint: "reducer.php",
      baseUrl: this.baseUrl,
      apiKey: maskApiKey(this.apiKey),
      imageCount: urls.length,
      imageUrls: urls,
      options: {
        lossy: payload.lossy,
        wait: payload.wait,
        upscale: options.upscale,
        resize: payload.resize,
        convertto: options.convertto,
        resize_width: options.resize_width,
        resize_height: options.resize_height,
        cmyk2rgb: options.cmyk2rgb,
        keep_exif: options.keep_exif,
        bg_remove: options.bg_remove,
        refresh: options.refresh,
        paramlist_count: Array.isArray(options.paramlist) ? options.paramlist.length : 0,
        returndatalist_count: Array.isArray(options.returndatalist)
          ? options.returndatalist.length
          : 0,
      },
    });

    const results = await this.optimizeWithRetry(payload);

    const summary = results.map((item) => {
      const status = item.Status;

      if (status && typeof status === "object") {
        const statusObject = status as Record<string, unknown>;
        return {
          code: statusObject.Code,
          message: statusObject.Message,
          originalUrl: item.OriginalURL,
          optimizedUrl: extractOptimizedUrl(item),
          percentImprovement: item.PercentImprovement,
        };
      }

      return {
        originalUrl: item.OriginalURL,
        optimizedUrl: extractOptimizedUrl(item),
      };
    });

    requestLogger.info("spio_response", {
      endpoint: "reducer.php",
      resultCount: results.length,
      results: summary,
    });

    return results;
  }

  private async optimizeWithRetry(
    initialPayload: Record<string, unknown>,
  ): Promise<Record<string, unknown>[]> {
    const results = await this.postJson("reducer.php", initialPayload);
    let pending = collectPendingEntries(results);
    let attempt = 1;
    let delayMs = this.retryInitialDelayMs;

    while (pending.length > 0 && attempt < this.retryMaxAttempts) {
      const retryUrls = pending.map((entry) => entry.url);
      const retryPayload = {
        ...initialPayload,
        urllist: retryUrls,
      };

      if ("paramlist" in retryPayload) {
        delete retryPayload.paramlist;
      }

      const nextAttempt = attempt + 1;

      requestLogger.info("spio_retry_wait", {
        endpoint: "reducer.php",
        attempt: nextAttempt,
        maxAttempts: this.retryMaxAttempts,
        pendingCount: pending.length,
        delayMs,
      });

      await sleep(delayMs);

      const retryResults = await this.postJson("reducer.php", retryPayload);
      mergeRetryResults(results, pending, retryResults);

      pending = collectPendingEntries(results);
      attempt = nextAttempt;
      delayMs = Math.min(delayMs * 2, this.retryMaxDelayMs);
    }

    if (pending.length > 0) {
      requestLogger.warn("spio_retry_exhausted", {
        endpoint: "reducer.php",
        maxAttempts: this.retryMaxAttempts,
        pendingCount: pending.length,
      });
    }

    return results;
  }

  private async postJson(
    endpoint: string,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>[]> {
    const startedAt = Date.now();
    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}/${endpoint}`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      requestLogger.error("spio_request_failed", {
        endpoint,
        durationMs: Date.now() - startedAt,
        message,
      });
      throw new Error(`ShortPixel API request failed: ${message}`);
    }

    const durationMs = Date.now() - startedAt;
    const body = await response.text();

    if (!response.ok) {
      requestLogger.warn("spio_http_error", {
        endpoint,
        durationMs,
        httpStatus: response.status,
        bodyPreview: body.slice(0, 500),
      });
    }
    let decoded: unknown;

    try {
      decoded = JSON.parse(body);
    } catch {
      requestLogger.error("spio_invalid_json", { endpoint, durationMs });
      throw new Error("ShortPixel API returned invalid JSON");
    }

    if (!Array.isArray(decoded)) {
      requestLogger.error("spio_unexpected_format", {
        endpoint,
        durationMs,
        bodyPreview: body.slice(0, 500),
      });
      return this.normalizeSpioResponse(decoded, body);
    }

    return decoded as Record<string, unknown>[];
  }

  private normalizeSpioResponse(
    decoded: unknown,
    rawBody: string,
  ): Record<string, unknown>[] {
    if (Array.isArray(decoded)) {
      return decoded as Record<string, unknown>[];
    }

    if (decoded && typeof decoded === "object") {
      const record = decoded as Record<string, unknown>;

      if (record.Status || record.OriginalURL) {
        return [record];
      }

      const indexedResults = Object.keys(record)
        .filter((key) => /^\d+$/.test(key))
        .sort((left, right) => Number(left) - Number(right))
        .map((key) => record[key])
        .filter((item): item is Record<string, unknown> => !!item && typeof item === "object");

      if (indexedResults.length > 0) {
        return indexedResults;
      }

      const message =
        typeof record.Message === "string"
          ? record.Message
          : typeof record.message === "string"
            ? record.message
            : rawBody.slice(0, 300);

      throw new Error(`ShortPixel API error: ${message}`);
    }

    throw new Error("ShortPixel API returned unexpected response format");
  }
}

function extractOptimizedUrl(item: Record<string, unknown>): string | undefined {
  const urlFields = [
    "LossyURL",
    "LosslessURL",
    "GlossyURL",
    "WebPLossyURL",
    "WebPLosslessURL",
    "WebPGlossyURL",
    "AVIFLossyURL",
    "AVIFLosslessURL",
  ];

  for (const field of urlFields) {
    const value = item[field];

    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return undefined;
}

function collectPendingEntries(
  results: Record<string, unknown>[],
): Array<{ index: number; url: string }> {
  const pending: Array<{ index: number; url: string }> = [];

  for (let index = 0; index < results.length; index += 1) {
    const item = results[index];
    const code = extractStatusCode(item);

    if (code !== 1) {
      continue;
    }

    const originalUrl = item.OriginalURL;

    if (typeof originalUrl === "string" && originalUrl.length > 0) {
      pending.push({ index, url: originalUrl });
    }
  }

  return pending;
}

function extractStatusCode(item: Record<string, unknown>): number | undefined {
  const status = item.Status;

  if (!status || typeof status !== "object") {
    return undefined;
  }

  const codeValue = (status as Record<string, unknown>).Code;

  if (typeof codeValue === "number") {
    return codeValue;
  }

  if (typeof codeValue === "string") {
    const parsed = Number(codeValue);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  return undefined;
}

function mergeRetryResults(
  originalResults: Record<string, unknown>[],
  pending: Array<{ index: number; url: string }>,
  retryResults: Record<string, unknown>[],
): void {
  const pendingByUrl = new Map<string, number>();

  for (const entry of pending) {
    pendingByUrl.set(entry.url, entry.index);
  }

  const unresolved = new Set<number>(pending.map((entry) => entry.index));

  for (const retryItem of retryResults) {
    const originalUrl = retryItem.OriginalURL;

    if (typeof originalUrl === "string") {
      const index = pendingByUrl.get(originalUrl);
      if (index !== undefined) {
        originalResults[index] = retryItem;
        unresolved.delete(index);
      }
    }
  }

  const unresolvedIndexes = Array.from(unresolved.values());
  let fallbackCursor = 0;

  for (const retryItem of retryResults) {
    const originalUrl = retryItem.OriginalURL;
    if (typeof originalUrl === "string" && pendingByUrl.has(originalUrl)) {
      continue;
    }

    const index = unresolvedIndexes[fallbackCursor];
    if (index === undefined) {
      break;
    }

    originalResults[index] = retryItem;
    fallbackCursor += 1;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
