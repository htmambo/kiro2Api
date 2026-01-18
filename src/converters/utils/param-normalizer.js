export function normalizeTokensConfig(params, defaults) {
    const maxTokens = params.max_tokens ?? defaults.max_tokens;
    const temperature = params.temperature ?? defaults.temperature;
    const topP = params.top_p ?? defaults.top_p;
    const normalized = {};

    if (maxTokens !== undefined) {
        normalized.max_tokens = maxTokens;
    }
    if (temperature !== undefined) {
        normalized.temperature = temperature;
    }
    if (topP !== undefined) {
        normalized.top_p = topP;
    }

    return normalized;
}
