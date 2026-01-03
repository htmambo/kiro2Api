import { v4 as uuidv4 } from 'uuid';
import { findMatchingBracket, repairJson } from './utils.js';

export const CC_TO_KIRO_TOOL_MAPPING = {
    Read: {
        kiroTool: 'readFile',
        paramMap: { file_path: 'path', offset: 'start_line', limit: 'end_line' },
        description: 'Read file content'
    },
    Write: {
        kiroTool: 'fsWrite',
        paramMap: { file_path: 'path', content: 'text' },
        description: 'Write file'
    },
    Edit: {
        kiroTool: 'strReplace',
        paramMap: { file_path: 'path', old_string: 'oldStr', new_string: 'newStr' },
        description: 'Replace text in file'
    },
    Bash: {
        kiroTool: 'executeBash',
        paramMap: { command: 'command', timeout: 'timeout' },
        description: 'Execute shell command'
    },
    Glob: {
        kiroTool: 'fileSearch',
        paramMap: { pattern: 'query' },
        description: 'Search files by pattern'
    },
    Grep: {
        kiroTool: 'grepSearch',
        paramMap: { pattern: 'query', path: 'includePattern' },
        description: 'Search content in files'
    },
    LS: {
        kiroTool: 'listDirectory',
        paramMap: { path: 'path' },
        description: 'List directory'
    },
    AskUserQuestion: {
        kiroTool: 'userInput',
        paramMap: { question: 'question' },
        description: 'Ask user for input'
    },
    Task: {
        kiroTool: 'invokeSubAgent',
        paramMap: { subagent_type: 'name', prompt: 'prompt', description: 'explanation' },
        description: 'Invoke sub-agent for complex tasks'
    },
    LSP: { remove: true, reason: 'Kiro getDiagnostics is not equivalent to CC LSP operations' },
    KillShell: {
        kiroTool: 'controlProcess',
        paramMap: { shell_id: 'processId' },
        fixedParams: { action: 'stop' },
        description: 'Stop background process'
    },
    TaskOutput: {
        kiroTool: 'getProcessOutput',
        paramMap: { task_id: 'processId' },
        description: 'Get process output'
    },
    WebSearch: {
        kiroTool: 'webSearch',
        paramMap: { query: 'query' },
        description: 'Search the web for information (server-side implementation)',
        serverSideExecute: true
    },
    WebFetch: { remove: true, reason: 'AWS CodeWhisperer does not support builtin tools' },
    TodoWrite: { remove: true, reason: 'Not supported by Kiro' },
    TodoRead: { remove: true, reason: 'Not supported by Kiro' },
    EnterPlanMode: { remove: true, reason: 'Not supported by Kiro' },
    ExitPlanMode: { remove: true, reason: 'Not supported by Kiro' },
    NotebookEdit: { remove: true, reason: 'Not supported by Kiro' },
    Skill: { remove: true, reason: 'CC internal only' },
    NotebookRead: {
        kiroTool: 'readFile',
        paramMap: { notebook_path: 'path' },
        description: 'Read notebook as file'
    }
};

export const KIRO_TOOL_SCHEMAS = {
    readFile: {
        type: 'object',
        properties: {
            path: { type: 'string' },
            start_line: { type: 'number' },
            end_line: { type: 'number' }
        },
        required: ['path']
    },
    fsWrite: {
        type: 'object',
        properties: {
            path: { type: 'string' },
            text: { type: 'string' }
        },
        required: ['path', 'text']
    },
    strReplace: {
        type: 'object',
        properties: {
            path: { type: 'string' },
            oldStr: { type: 'string' },
            newStr: { type: 'string' }
        },
        required: ['path', 'oldStr', 'newStr']
    },
    grepSearch: {
        type: 'object',
        properties: {
            query: { type: 'string' },
            includePattern: { type: 'string' }
        },
        required: ['query']
    },
    fileSearch: {
        type: 'object',
        properties: {
            query: { type: 'string' }
        },
        required: ['query']
    },
    executeBash: {
        type: 'object',
        properties: {
            command: { type: 'string' },
            timeout: { type: 'number' }
        },
        required: ['command']
    },
    listDirectory: {
        type: 'object',
        properties: {
            path: { type: 'string' }
        },
        required: ['path']
    },
    userInput: {
        type: 'object',
        properties: {
            question: { type: 'string' },
            options: { type: 'array', items: { type: 'string' } }
        },
        required: ['question']
    },
    getDiagnostics: {
        type: 'object',
        properties: {
            paths: { type: 'array', items: { type: 'string' } }
        },
        required: ['paths']
    },
    controlProcess: {
        type: 'object',
        properties: {
            action: { type: 'string', enum: ['start', 'stop', 'restart'] },
            command: { type: 'string' },
            processId: { type: 'string' }
        },
        required: ['action']
    },
    getProcessOutput: {
        type: 'object',
        properties: {
            processId: { type: 'string' },
            lines: { type: 'number' }
        },
        required: ['processId']
    },
    invokeSubAgent: {
        type: 'object',
        properties: {
            name: { type: 'string' },
            prompt: { type: 'string' },
            explanation: { type: 'string' }
        },
        required: ['name', 'prompt', 'explanation']
    },
    webSearch: {
        type: 'object',
        properties: {
            query: { type: 'string' }
        },
        required: ['query']
    }
};

export function mapToolUseParams(toolName, input, verboseLogging = false) {
    if (input === undefined || input === null) {
        return {};
    }

    if (typeof input !== 'object') {
        if (verboseLogging) {
            console.log(`[Kiro ParamMap] ${toolName}: input is not object (${typeof input}), wrapping in object`);
        }
        return { value: input };
    }

    const mapping = CC_TO_KIRO_TOOL_MAPPING[toolName];
    if (!mapping) {
        if (verboseLogging) {
            console.log(`[Kiro ParamMap] ${toolName}: no mapping found, using original input`);
        }
        return input;
    }

    const mappedInput = {};

    if (mapping.paramMap) {
        for (const [ccParam, kiroParam] of Object.entries(mapping.paramMap)) {
            if (input[ccParam] !== undefined) {
                mappedInput[kiroParam] = input[ccParam];
                if (verboseLogging || toolName === 'Task') {
                    console.log(`[Kiro ParamMap] ${toolName}: mapped ${ccParam} → ${kiroParam} = ${JSON.stringify(input[ccParam])}`);
                }
            }
        }
    }

    for (const [key, value] of Object.entries(input)) {
        if (!mapping.paramMap || !mapping.paramMap[key]) {
            mappedInput[key] = value;
        }
    }

    if (mapping.fixedParams) {
        Object.assign(mappedInput, mapping.fixedParams);
    }

    return mappedInput;
}

export function reverseMapToolInput(toolName, input, verboseLogging = false) {
    if (!input || typeof input !== 'object') {
        return input;
    }

    const mapping = CC_TO_KIRO_TOOL_MAPPING[toolName];
    if (!mapping || !mapping.paramMap) {
        return input;
    }

    const reverseMap = {};
    for (const [ccParam, kiroParam] of Object.entries(mapping.paramMap)) {
        reverseMap[kiroParam] = ccParam;
    }

    const kiroOnlyParams = [
        'explanation', 'ignoreWarning', 'depth', 'reason',
        'caseSensitive', 'excludePattern', 'includeIgnoredFiles',
        'raw', 'raw_arguments', 'value'
    ];

    const reversedInput = {};

    for (const [key, value] of Object.entries(input)) {
        if (reverseMap[key]) {
            reversedInput[reverseMap[key]] = value;
            if (verboseLogging) {
                console.log(`[Kiro ReverseMap] ${toolName}: reversed ${key} → ${reverseMap[key]}`);
            }
        } else if (!kiroOnlyParams.includes(key)) {
            reversedInput[key] = value;
        }
    }

    return reversedInput;
}

export function parseSingleToolCall(toolCallText) {
    const namePattern = /\[Called\s+(\w+)\s+with\s+args:/i;
    const nameMatch = toolCallText.match(namePattern);

    if (!nameMatch) {
        return null;
    }

    const functionName = nameMatch[1].trim();
    const argsStartMarker = "with args:";
    const argsStartPos = toolCallText.toLowerCase().indexOf(argsStartMarker.toLowerCase());

    if (argsStartPos === -1) {
        return null;
    }

    const argsStart = argsStartPos + argsStartMarker.length;
    const argsEnd = toolCallText.lastIndexOf(']');

    if (argsEnd <= argsStart) {
        return null;
    }

    const jsonCandidate = toolCallText.substring(argsStart, argsEnd).trim();

    try {
        const repairedJson = repairJson(jsonCandidate);
        const argumentsObj = JSON.parse(repairedJson);

        if (typeof argumentsObj !== 'object' || argumentsObj === null) {
            return null;
        }

        const toolCallId = `call_${uuidv4().replace(/-/g, '').substring(0, 8)}`;
        return {
            id: toolCallId,
            type: "function",
            function: {
                name: functionName,
                arguments: JSON.stringify(argumentsObj)
            }
        };
    } catch (e) {
        console.error(`Failed to parse tool call arguments: ${e.message}`, jsonCandidate);
        return null;
    }
}

export function parseBracketToolCalls(responseText) {
    if (!responseText || !responseText.includes("[Called")) {
        return null;
    }

    const toolCalls = [];
    const callPositions = [];
    let start = 0;
    while (true) {
        const pos = responseText.indexOf("[Called", start);
        if (pos === -1) {
            break;
        }
        callPositions.push(pos);
        start = pos + 1;
    }

    for (let i = 0; i < callPositions.length; i++) {
        const startPos = callPositions[i];
        let endSearchLimit;
        if (i + 1 < callPositions.length) {
            endSearchLimit = callPositions[i + 1];
        } else {
            endSearchLimit = responseText.length;
        }

        const segment = responseText.substring(startPos, endSearchLimit);
        const bracketEnd = findMatchingBracket(segment, 0);

        let toolCallText;
        if (bracketEnd !== -1) {
            toolCallText = segment.substring(0, bracketEnd + 1);
        } else {
            const lastBracket = segment.lastIndexOf(']');
            if (lastBracket !== -1) {
                toolCallText = segment.substring(0, lastBracket + 1);
            } else {
                continue;
            }
        }

        const parsedCall = parseSingleToolCall(toolCallText);
        if (parsedCall) {
            toolCalls.push(parsedCall);
        }
    }
    return toolCalls.length > 0 ? toolCalls : null;
}

export function deduplicateToolCalls(toolCalls) {
    const seen = new Set();
    const uniqueToolCalls = [];

    for (const tc of toolCalls) {
        const key = `${tc.function.name}-${tc.function.arguments}`;
        if (!seen.has(key)) {
            seen.add(key);
            uniqueToolCalls.push(tc);
        } else {
            console.log(`Skipping duplicate tool call: ${tc.function.name}`);
        }
    }
    return uniqueToolCalls;
}

export function copyToolMapping(toolName) {
    const base = CC_TO_KIRO_TOOL_MAPPING[toolName];
    if (!base) return null;
    return JSON.parse(JSON.stringify(base));
}
