const fs = require('node:fs');
const path = require('node:path');

describe('config manager startup safeguards', () => {
  test('initializeConfig ensures runtime directories before touching config.json', () => {
    const source = fs.readFileSync(path.resolve('src/config/manager.js'), 'utf8');
    const ensureCallIndex = source.indexOf('ensureConfigDirectories(configFilePath);');
    const readConfigIndex = source.indexOf("fs.readFileSync(configFilePath, 'utf8')");
    const writeConfigIndex = source.indexOf('fs.writeFileSync(configFilePath');

    expect(ensureCallIndex).toBeGreaterThan(-1);
    expect(readConfigIndex).toBeGreaterThan(-1);
    expect(writeConfigIndex).toBeGreaterThan(-1);
    expect(ensureCallIndex).toBeLessThan(readConfigIndex);
    expect(ensureCallIndex).toBeLessThan(writeConfigIndex);
  });

  test('config template uses runtime account pool path', () => {
    const template = JSON.parse(fs.readFileSync(path.resolve('configs/templates/config.json.example'), 'utf8'));

    expect(template.ACCOUNT_POOL_FILE_PATH).toBe('./configs/runtime/account_pool.json');
  });
});
