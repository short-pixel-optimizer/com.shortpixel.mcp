import { getPluginVersion, getSpioApiUrl } from "../config/environment.js";
import { maskApiKey, requestLogger } from "../logging/request-logger.js";

export type OptimizeOptions = {
  lossy?: number;
  wait?: number;
  resize?: number;
  convertto?: string;
  resize_width?: number;
  resize_height?: number;
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
        resize: payload.resize,
        convertto: options.convertto,
        resize_width: options.resize_width,
        resize_height: options.resize_height,
      },
    });

    const results = await this.postJson("reducer.php", payload);

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
