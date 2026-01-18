import {
    generateResponseCreated,
    generateResponseInProgress,
    generateOutputItemAdded,
    generateContentPartAdded,
    generateOutputTextDone,
    generateContentPartDone,
    generateOutputItemDone,
    generateResponseCompleted
} from '../../openai/openai-responses-core.mjs';

export function buildResponsesStartEvents(responseId, model) {
    return [
        generateResponseCreated(responseId, model || 'unknown'),
        generateResponseInProgress(responseId),
        generateOutputItemAdded(responseId),
        generateContentPartAdded(responseId)
    ];
}

export function buildResponsesDoneEvents(responseId) {
    return [
        generateOutputTextDone(responseId),
        generateContentPartDone(responseId),
        generateOutputItemDone(responseId),
        generateResponseCompleted(responseId)
    ];
}

export function applyUsageToLastEvent(events, usage) {
    if (!usage || events.length === 0) {
        return;
    }
    const lastEvent = events[events.length - 1];
    if (lastEvent.response) {
        lastEvent.response.usage = usage;
    }
}
