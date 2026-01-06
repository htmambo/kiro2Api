import deepmerge from 'deepmerge';
import { getServiceAdapter, serviceInstances } from '../kiro/adapter.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('services:manager');
