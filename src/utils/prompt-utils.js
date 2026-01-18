export function extractPromptText(requestBody) {
    if (requestBody.messages && requestBody.messages.length > 0) {
        const lastMessage = requestBody.messages[requestBody.messages.length - 1];
        if (lastMessage.content && Array.isArray(lastMessage.content)) {
            return lastMessage.content.map(block => block.text).join('');
        }
        return lastMessage.content;
    }
    return '';
}

export function extractSystemPromptFromRequestBody(requestBody, provider) {
    let incomingSystemText = '';
    if (typeof requestBody.system === 'string') {
        incomingSystemText = requestBody.system;
    } else if (typeof requestBody.system === 'object') {
        incomingSystemText = JSON.stringify(requestBody.system);
    } else if (requestBody.messages?.length > 0) {
        const userMessage = requestBody.messages.find(m => m.role === 'user');
        if (userMessage) {
            if (Array.isArray(userMessage.content)) {
                incomingSystemText = userMessage.content.map(block => block.text).join('');
            } else {
                incomingSystemText = userMessage.content;
            }
        }
    }
    return incomingSystemText;
}
