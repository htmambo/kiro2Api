#!/usr/bin/env node
/**
 * 模型名称检测工具
 * 
 * 功能：
 * 1. 列出所有支持的 Kiro 模型
 * 2. 显示模型映射关系（Anthropic → AWS CodeWhisperer）
 * 3. 检查配置一致性
 * 4. 验证默认模型
 */

import { KIRO_MODELS, KIRO_CONSTANTS } from '../src/kiro/constants.js';
import { MODEL_MAPPING } from '../src/kiro/adapter.js';

console.log('='.repeat(80));
console.log('🔍 Kiro 模型名称检测报告');
console.log('='.repeat(80));
console.log();

// 1. 支持的模型列表
console.log('📋 支持的 Kiro 模型列表 (KIRO_MODELS):');
console.log('-'.repeat(80));
KIRO_MODELS.forEach((model, index) => {
    const isDefault = model === KIRO_CONSTANTS.DEFAULT_MODEL_NAME;
    const marker = isDefault ? '⭐' : '  ';
    console.log(`${marker} ${index + 1}. ${model}${isDefault ? ' (默认)' : ''}`);
});
console.log();

// 2. 模型映射关系
console.log('🔄 模型映射关系 (MODEL_MAPPING):');
console.log('-'.repeat(80));
console.log('Anthropic 模型 ID → AWS CodeWhisperer 模型 ID');
console.log();

const mappingEntries = Object.entries(MODEL_MAPPING);
if (mappingEntries.length === 0) {
    console.log('⚠️  警告: MODEL_MAPPING 为空！');
} else {
    mappingEntries.forEach(([anthropicModel, awsModel]) => {
        const inKiroModels = KIRO_MODELS.includes(anthropicModel);
        const marker = inKiroModels ? '✓' : '✗';
        console.log(`${marker} ${anthropicModel.padEnd(35)} → ${awsModel}`);
    });
}
console.log();

// 3. 配置一致性检查
console.log('🔍 配置一致性检查:');
console.log('-'.repeat(80));

const issues = [];

// 检查 1: 默认模型是否在支持列表中
const defaultModelInList = KIRO_MODELS.includes(KIRO_CONSTANTS.DEFAULT_MODEL_NAME);
if (defaultModelInList) {
    console.log('✓ 默认模型在支持列表中');
} else {
    console.log('✗ 默认模型不在支持列表中');
    issues.push(`默认模型 "${KIRO_CONSTANTS.DEFAULT_MODEL_NAME}" 不在 KIRO_MODELS 中`);
}

// 检查 2: 默认模型是否有映射
const defaultModelHasMapping = MODEL_MAPPING[KIRO_CONSTANTS.DEFAULT_MODEL_NAME];
if (defaultModelHasMapping) {
    console.log(`✓ 默认模型有映射: ${KIRO_CONSTANTS.DEFAULT_MODEL_NAME} → ${defaultModelHasMapping}`);
} else {
    console.log('✗ 默认模型没有映射');
    issues.push(`默认模型 "${KIRO_CONSTANTS.DEFAULT_MODEL_NAME}" 在 MODEL_MAPPING 中没有映射`);
}

// 检查 3: KIRO_MODELS 中的所有模型是否都有映射
const modelsWithoutMapping = KIRO_MODELS.filter(model => !MODEL_MAPPING[model]);
if (modelsWithoutMapping.length === 0) {
    console.log('✓ 所有支持的模型都有映射');
} else {
    console.log(`✗ ${modelsWithoutMapping.length} 个模型没有映射`);
    modelsWithoutMapping.forEach(model => {
        console.log(`  - ${model}`);
        issues.push(`模型 "${model}" 在 KIRO_MODELS 中但没有映射`);
    });
}

// 检查 4: MODEL_MAPPING 中是否有不在 KIRO_MODELS 中的模型
const mappingsNotInKiroModels = Object.keys(MODEL_MAPPING).filter(
    model => !KIRO_MODELS.includes(model)
);
if (mappingsNotInKiroModels.length === 0) {
    console.log('✓ 所有映射的模型都在支持列表中');
} else {
    console.log(`⚠️  ${mappingsNotInKiroModels.length} 个映射的模型不在 KIRO_MODELS 中`);
    mappingsNotInKiroModels.forEach(model => {
        console.log(`  - ${model}`);
    });
    console.log('  (这可能是正常的，如果这些是别名或兼容性映射)');
}

console.log();

// 4. 统计信息
console.log('📊 统计信息:');
console.log('-'.repeat(80));
console.log(`支持的模型数量: ${KIRO_MODELS.length}`);
console.log(`模型映射数量: ${Object.keys(MODEL_MAPPING).length}`);
console.log(`默认模型: ${KIRO_CONSTANTS.DEFAULT_MODEL_NAME}`);
console.log();

// 5. 模型系列分析
console.log('🏷️  模型系列分析:');
console.log('-'.repeat(80));

const modelFamilies = {
    'Opus 4.5': KIRO_MODELS.filter(m => m.includes('opus-4-5') || m.includes('opus-4.5')),
    'Sonnet 4.5': KIRO_MODELS.filter(m => m.includes('sonnet-4-5') || m.includes('sonnet-4.5')),
    'Sonnet 4.0': KIRO_MODELS.filter(m => m.includes('sonnet-4-') && !m.includes('4-5')),
    'Sonnet 3.7': KIRO_MODELS.filter(m => m.includes('3-7-sonnet')),
    'Haiku 4.5': KIRO_MODELS.filter(m => m.includes('haiku-4-5') || m.includes('haiku-4.5')),
};

Object.entries(modelFamilies).forEach(([family, models]) => {
    if (models.length > 0) {
        console.log(`${family}: ${models.length} 个模型`);
        models.forEach(model => {
            const isDefault = model === KIRO_CONSTANTS.DEFAULT_MODEL_NAME;
            const marker = isDefault ? '⭐' : '  ';
            console.log(`${marker} - ${model}`);
        });
    }
});
console.log();

// 6. 问题汇总
if (issues.length > 0) {
    console.log('❌ 发现的问题:');
    console.log('-'.repeat(80));
    issues.forEach((issue, index) => {
        console.log(`${index + 1}. ${issue}`);
    });
    console.log();
    process.exit(1);
} else {
    console.log('✅ 所有检查通过！模型配置正常。');
    console.log();
    process.exit(0);
}
