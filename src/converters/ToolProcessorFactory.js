import { createLogger } from '../lib/logger.js';

const logger = createLogger({ module: 'ToolProcessorFactory' });

export class ToolProcessorFactory {
    static #processors = new Map();

    static getProcessor(sourceFormat, targetFormat) {
        const key = `${sourceFormat}_to_${targetFormat}`;

        if (!this.#processors.has(key)) {
            this.#processors.set(key, this.createProcessor(sourceFormat, targetFormat));
        }

        return this.#processors.get(key);
    }

    static createProcessor(sourceFormat, targetFormat) {
        logger.warn(`Tool processor for ${sourceFormat} to ${targetFormat} not yet implemented`);
        return null;
    }

    static clearCache() {
        this.#processors.clear();
    }
}
