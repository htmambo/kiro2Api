import { MODEL_PROTOCOL_PREFIX } from './common.js';
import { ClaudeStrategy } from './claude/claude-strategy.js';

/**
 * Strategy factory that returns the appropriate strategy instance based on the provider protocol.
 * Simplified for Kiro OAuth only - uses Claude protocol.
 */
class ProviderStrategyFactory {
    static getStrategy(providerProtocol) {
        switch (providerProtocol) {
            case MODEL_PROTOCOL_PREFIX.CLAUDE:
                return new ClaudeStrategy();
            default:
                // Default to Claude strategy for Kiro
                return new ClaudeStrategy();
        }
    }
}

export { ProviderStrategyFactory };
