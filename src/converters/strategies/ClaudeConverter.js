/**
 * Claude转换器
 * 处理Claude（Anthropic）协议与其他协议之间的转换
 */

import { v4 as uuidv4 } from 'uuid';
import { BaseConverter } from '../BaseConverter.js';

/**
 * Claude转换器类
 * 实现Claude协议到其他协议的转换
 */
export class ClaudeConverter extends BaseConverter {
    constructor() {
        super('claude');
    }

    /**
     * 处理Claude响应内容
     */
    processClaudeResponseContent(content) {
        if (!content || !Array.isArray(content)) return '';
        
        const contentArray = [];
        
        content.forEach(block => {
            if (!block) return;
            
            switch (block.type) {
                case 'text':
                    contentArray.push({
                        type: 'text',
                        text: block.text || ''
                    });
                    break;
                    
                case 'image':
                    if (block.source && block.source.type === 'base64') {
                        contentArray.push({
                            type: 'image_url',
                            image_url: {
                                url: `data:${block.source.media_type};base64,${block.source.data}`
                            }
                        });
                    }
                    break;
                    
                default:
                    if (block.text) {
                        contentArray.push({
                            type: 'text',
                            text: block.text
                        });
                    }
            }
        });
        
        return contentArray.length === 1 && contentArray[0].type === 'text'
            ? contentArray[0].text
            : contentArray;
    }

}

export default ClaudeConverter;