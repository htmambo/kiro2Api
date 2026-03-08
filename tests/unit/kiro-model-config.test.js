import { describe, expect, test } from '@jest/globals';
import {
    DEFAULT_PUBLIC_MODEL,
    DEFAULT_SUMMARIZATION_MODEL,
    FULL_MODEL_MAPPING,
    isSupportedKiroModel,
    KIRO_MODELS,
    MODEL_MAPPING,
    resolveRequestModel,
    normalizeRequestedModel,
    REQUEST_MODEL_ALIASES
} from '../../src/kiro/model-config.js';

describe('kiro model config relationships', () => {
    test('MODEL_MAPPING 只保留 KIRO_MODELS 中出现的模型键', () => {
        expect(Object.keys(MODEL_MAPPING).every((modelName) => KIRO_MODELS.includes(modelName))).toBe(true);
    });

    test('MODEL_MAPPING 中每个键值都来自 FULL_MODEL_MAPPING', () => {
        for (const [modelName, awsModelId] of Object.entries(MODEL_MAPPING)) {
            expect(FULL_MODEL_MAPPING[modelName]).toBe(awsModelId);
        }
    });

    test('KIRO_MODELS 中每个模型都能在 MODEL_MAPPING 中找到运行时映射', () => {
        for (const modelName of KIRO_MODELS) {
            expect(MODEL_MAPPING[modelName]).toEqual(expect.any(String));
        }
    });

    test('isSupportedKiroModel 会准确反映白名单状态', () => {
        expect(isSupportedKiroModel('claude-sonnet-4-5')).toBe(true);
        expect(isSupportedKiroModel('unknown-model')).toBe(false);
        expect(isSupportedKiroModel(undefined)).toBe(false);
    });

    test('resolveRequestModel 与 normalizeRequestedModel 保持一致', () => {
        expect(resolveRequestModel('gpt-5.2')).toBe(normalizeRequestedModel('gpt-5.2'));
        expect(resolveRequestModel('unknown-model')).toBe(normalizeRequestedModel('unknown-model'));
    });

    test('normalizeRequestedModel 会应用历史别名映射', () => {
        for (const [legacyModel, normalizedModel] of Object.entries(REQUEST_MODEL_ALIASES)) {
            expect(normalizeRequestedModel(legacyModel)).toBe(normalizedModel);
        }
    });

    test('normalizeRequestedModel 会把未知模型回退到 DEFAULT_PUBLIC_MODEL', () => {
        expect(normalizeRequestedModel('unknown-model')).toBe(DEFAULT_PUBLIC_MODEL);
        expect(normalizeRequestedModel(undefined)).toBe(DEFAULT_PUBLIC_MODEL);
        expect(normalizeRequestedModel(null)).toBe(DEFAULT_PUBLIC_MODEL);
    });

    test('normalizeRequestedModel 对已支持模型保持原样', () => {
        expect(normalizeRequestedModel('claude-opus-4-5')).toBe('claude-opus-4-5');
        expect(normalizeRequestedModel(DEFAULT_PUBLIC_MODEL)).toBe(DEFAULT_PUBLIC_MODEL);
    });

    test('DEFAULT_SUMMARIZATION_MODEL 也属于支持模型并具备运行时映射', () => {
        expect(KIRO_MODELS).toContain(DEFAULT_SUMMARIZATION_MODEL);
        expect(MODEL_MAPPING[DEFAULT_SUMMARIZATION_MODEL]).toEqual(expect.any(String));
    });
});
