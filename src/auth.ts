export interface ClientAuth {
  apiKey: string;
  useVertex: boolean;
}

/**
 * Resolves which API key and backend service endpoint to use.
 * - If geminiApiKey is provided, Gemini API endpoints are used (useVertex: false).
 * - Else if agentPlatformApiKey is provided, Vertex AI endpoints are used (useVertex: true).
 * - Throws an Error if neither is provided.
 */
export function resolveAuth(
  geminiApiKey?: string,
  agentPlatformApiKey?: string
): ClientAuth {
  const gemini = geminiApiKey?.trim();
  const agentPlatform = agentPlatformApiKey?.trim();

  if (gemini) {
    return { apiKey: gemini, useVertex: false };
  }

  if (agentPlatform) {
    return { apiKey: agentPlatform, useVertex: true };
  }

  throw new Error(
    "Neither gemini_api_key (GEMINI_API_KEY) nor agent_platform_api_key (AGENT_PLATFORM_API_KEY) is set. One of them is required."
  );
}
