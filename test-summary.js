import fs from 'fs';
import path from 'path';

const rootDir = path.resolve(process.cwd(), 'tests');

function collectTestFiles(dirPath) {
    if (!fs.existsSync(dirPath)) {
        return [];
    }

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            files.push(...collectTestFiles(fullPath));
            continue;
        }

        if (entry.isFile() && entry.name.endsWith('.test.js')) {
            files.push(fullPath);
        }
    }

    return files;
}

function summarizeByCategory(files) {
    return files.reduce((summary, filePath) => {
        const relativePath = path.relative(rootDir, filePath);
        const [category = 'misc'] = relativePath.split(path.sep);
        summary[category] = summary[category] || [];
        summary[category].push(relativePath);
        return summary;
    }, {});
}

const files = collectTestFiles(rootDir);
const summary = summarizeByCategory(files);

console.log('Kiro2Api 测试概览');
console.log('=================');
console.log(`共发现 ${files.length} 个测试文件`);

for (const [category, categoryFiles] of Object.entries(summary)) {
    console.log(`- ${category}: ${categoryFiles.length} 个`);
    for (const relativePath of categoryFiles) {
        console.log(`  • ${relativePath}`);
    }
}

if (files.length === 0) {
    process.exitCode = 1;
}
