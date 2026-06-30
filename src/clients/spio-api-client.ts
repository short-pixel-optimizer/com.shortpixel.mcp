import { getPluginVersion, getSpioApiUrl } from "../config/environment.js";

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

    return this.postJson("reducer.php", payload);
  }

  private async postJson(
    endpoint: string,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>[]> {
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
      throw new Error(`ShortPixel API request failed: ${message}`);
    }

    const body = await response.text();
    let decoded: unknown;

    try {
      decoded = JSON.parse(body);
    } catch {
      throw new Error("ShortPixel API returned invalid JSON");
    }

    if (!Array.isArray(decoded)) {
      throw new Error("ShortPixel API returned unexpected response format");
    }

    return decoded as Record<string, unknown>[];
  }
}
