import { createLogger } from '../../lib/logger.js';
import { countMessageTokens, countTextTokens } from '../utils/token-counter.js';
import { streamApiReal } from '../streaming.js';
import { buildMessagesWithSummary, SUMMARIZATION_CONFIG } from '../summarization.js';
import { getContentText } from '../message-sanitizer.js';

const logger = createLogger('adapter');

export function reverseMapSchema(schema, paramMap) {
    if (!schema || typeof schema !== 'object') {
        return schema;
    }

    const reverseMap = {};
    for (const [ccParam, kiroParam] of Object.entries(paramMap)) {
        reverseMap[kiroParam] = ccParam;
    }

    const newSchema = { ...schema };

    if (newSchema.properties && typeof newSchema.properties === 'object') {
        const newProperties = {};
        for (const [key, value] of Object.entries(newSchema.properties)) {
            const newKey = reverseMap[key] || key;
            newProperties[newKey] = value;
        }
        newSchema.properties = newProperties;
    }

    if (Array.isArray(newSchema.required)) {
        newSchema.required = newSchema.required.map(param => reverseMap[param] || param);
    }

    return newSchema;
}

export function extractMetadata(messages, key) {
    if (!messages || messages.length === 0) return null;

    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.additional_kwargs && msg.additional_kwargs[key]) {
            logger.debug(`Extracted ${key}:`, { value: msg.additional_kwargs[key] });
            return msg.additional_kwargs[key];
        }
    }
    return null;
}

export function extractSupplementalContext(message) {
    const supplementalContexts = [];

    if (!message || !message.additional_kwargs) {
        return supplementalContexts;
    }

    const kwargs = message.additional_kwargs;

    if (kwargs.recentlyEditedFiles && Array.isArray(kwargs.recentlyEditedFiles)) {
        kwargs.recentlyEditedFiles.forEach(file => {
            if (file.filepath && file.contents) {
                supplementalContexts.push({
                    filePath: file.filepath,
                    content: file.contents
                });
            }
        });
    }

    if (kwargs.recentlyEditedRanges && Array.isArray(kwargs.recentlyEditedRanges)) {
        kwargs.recentlyEditedRanges.forEach(range => {
            if (range.filepath && range.lines) {
                supplementalContexts.push({
                    filePath: range.filepath,
                    content: Array.isArray(range.lines) ? range.lines.join('\n') : range.lines
                });
            }
        });
    }

    if (kwargs.cursorContext) {
        const ctx = kwargs.cursorContext;
        if (ctx.filepath && ctx.content) {
            supplementalContexts.push({
                filePath: ctx.filepath,
                content: ctx.content
            });
        }
    }

    return supplementalContexts;
}

export function pruneStringFromTop(tokenizer, text, maxTokens) {
    try {
        const tokens = tokenizer.encode(text);
        if (tokens.length <= maxTokens) {
            return text;
        }
        const prunedTokens = tokens.slice(tokens.length - maxTokens);
        return tokenizer.decode(prunedTokens);
    } catch (error) {
        logger.warn('Tokenizer failed, using character estimation');
        const estimatedChars = Math.floor(maxTokens * 3.5);
        return text.substring(text.length - estimatedChars);
    }
}

export function summarizeMessage(message) {
    const content = message.content;
    const textLimit = 1000;
    const toolLimit = 2000;

    if (Array.isArray(content)) {
        const summarizedContent = [];
        for (const part of content) {
            if (part.type === 'text' && part.text) {
                const truncated = part.text.length > textLimit
                    ? part.text.substring(0, textLimit) + '...'
                    : part.text;
                summarizedContent.push({ type: 'text', text: truncated });
            } else if (part.type === 'tool_result') {
                const truncatedResult = {
                    type: 'tool_result',
                    tool_use_id: part.tool_use_id
                };
                if (part.content) {
                    if (typeof part.content === 'string') {
                        const truncated = part.content.length > toolLimit
                            ? part.content.substring(0, toolLimit) + '...'
                            : part.content;
                        truncatedResult.content = truncated;
                    } else if (Array.isArray(part.content)) {
                        truncatedResult.content = part.content.map(c => {
                            if (c.type === 'text' && c.text) {
                                const truncated = c.text.length > toolLimit
                                    ? c.text.substring(0, toolLimit) + '...'
                                    : c.text;
                                return { ...c, text: truncated };
                            }
                            return c;
                        });
                    }
                }
                if (part.is_error) {
                    truncatedResult.is_error = part.is_error;
                }
                summarizedContent.push(truncatedResult);
            } else if (part.type === 'tool_use') {
                summarizedContent.push({
                    type: 'tool_use',
                    id: part.id,
                    name: part.name,
                    input: part.input
                });
            }
        }
        return summarizedContent;
    }

    if (typeof content === 'string') {
        return content.length > textLimit ? content.substring(0, textLimit) + '...' : content;
    }

    return content;
}

export async function pruneChatHistoryWithAI(service, messages, contextLength, reservedTokens) {
    try {
        const now = Date.now();
        const minMessagesForSummary = 10;
        const cooldown = 60 * 1000;

        if (messages.length < minMessagesForSummary) {
            return service.pruneChatHistory(messages, contextLength, reservedTokens);
        }

        if (service._lastSummarizationTime && (now - service._lastSummarizationTime) < cooldown) {
            return service.pruneChatHistory(messages, contextLength, reservedTokens);
        }

        const totalTokens = messages.reduce((acc, message) => acc + countMessageTokens(message, true), 0);
        const messagesToSummarize = messages.slice(0, -4);
        if (messagesToSummarize.length <= 3) {
            return service.pruneChatHistory(messages, contextLength, reservedTokens);
        }

        const conversationData = messagesToSummarize.map(m => m.content).join('\n');
        if (conversationData.length > 50000) {
            return service.pruneChatHistory(messages, contextLength, reservedTokens);
        }

        const summaryPrompt = `[SYSTEM NOTE: Context limit reached. Create a structured summary.]
You are preparing a summary for a new agent instance who will pick up this conversation.
Organize the summary by TASKS/REQUESTS. For each distinct task:
- What was requested
- What is done
- What remains
Include key configuration, decisions, and context.\n`;

        const summaryRequestBody = {
            messages: [{ role: 'user', content: summaryPrompt }],
            tools: null
        };

        const summaryModel = SUMMARIZATION_CONFIG.SUMMARIZATION_MODEL || 'claude-sonnet-4-5-20250929';

        const summaryPromise = (async () => {
            let summaryText = '';
            for await (const event of streamApiReal(service, '', summaryModel, summaryRequestBody)) {
                if (event.type === 'content' && event.content) {
                    summaryText += event.content;
                }
            }
            return summaryText;
        })();

        const timeoutPromise = new Promise(resolve => {
            setTimeout(() => resolve(null), SUMMARIZATION_CONFIG.SUMMARIZATION_TIMEOUT || 8000);
        });

        const summary = await Promise.race([summaryPromise, timeoutPromise]);
        if (summary) {
            service._lastSummarizationTime = now;
            const recentMessages = messages.slice(-4);
            return buildMessagesWithSummary(summary, recentMessages, messages.length);
        }
    } catch (error) {
        logger.warn(`Summarization failed: ${error.message}`);
    }

    return service.pruneChatHistory(messages, contextLength, reservedTokens);
}

export function pruneChatHistory(tokenizer, messages, contextLength, tokensForCompletion) {
    const chatHistory = messages;
    const getTokens = (message) => countMessageTokens(message, true);

    let totalTokens = chatHistory.reduce((acc, message) => acc + getTokens(message), 0);
    if (totalTokens <= contextLength) {
        return chatHistory;
    }

    const longerThanOneThird = chatHistory.filter(m => getTokens(m) > contextLength / 3);
    for (const message of longerThanOneThird) {
        const oldTokens = getTokens(message);
        const summarized = summarizeMessage(message);
        const newTokens = countTextTokens(getContentText({ content: summarized }), true);
        message.content = summarized;
        totalTokens = totalTokens - oldTokens + newTokens;
    }

    if (totalTokens <= contextLength) {
        return chatHistory;
    }

    let i = 0;
    while (totalTokens > contextLength && i < chatHistory.length - 5) {
        const message = chatHistory[i];
        const content = getContentText(message);
        if (content.endsWith('...') && content.length <= 103) {
            i++;
            continue;
        }
        const oldTokens = getTokens(message);
        const summarized = summarizeMessage(message);
        const newTokens = countTextTokens(getContentText({ content: summarized }), true);
        message.content = summarized;
        totalTokens = totalTokens - oldTokens + newTokens;
        i++;
    }

    if (totalTokens <= contextLength) {
        return chatHistory;
    }

    while (totalTokens > contextLength && chatHistory.length > 1) {
        const message = chatHistory.shift();
        totalTokens -= getTokens(message);
    }

    if (totalTokens <= contextLength) {
        return chatHistory;
    }

    if (totalTokens > contextLength && chatHistory.length > 0) {
        const message = chatHistory[0];
        const currentMessageTokens = getTokens(message);
        const tokensToRemove = totalTokens - contextLength;
        const targetMessageTokens = Math.max(100, currentMessageTokens - tokensToRemove);

        if (Array.isArray(message.content)) {
            for (const part of message.content) {
                if (part.type === 'tool_result') {
                    part.content = '[... content truncated ...]';
                }
            }
        }

        const content = getContentText(message);
        const estimatedChars = Math.floor(targetMessageTokens * 3.5);
        const prunedText = content.substring(content.length - estimatedChars);
        if (Array.isArray(message.content)) {
            message.content = [{ type: 'text', text: prunedText }];
        } else {
            message.content = prunedText;
        }
    }

    return chatHistory;
}
