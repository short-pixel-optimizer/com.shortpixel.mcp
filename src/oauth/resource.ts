import { getOauthResourceIdentifier } from "../config/environment.js";

// The single protected resource this AS issues tokens for - the /mcp
// endpoint on this same server. MCP clients identify it via the OAuth
// `resource` parameter (RFC 8707); provider.ts's defaultResource means they
// don't have to when there's only ever this one resource to ask for
export const MCP_RESOURCE_IDENTIFIER = getOauthResourceIdentifier();
export const MCP_SCOPE = "mcp";
