const fs = require('node:fs');
const path = require('node:path');

const rootPackage = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
const frontendVuePackage = JSON.parse(fs.readFileSync(path.resolve('frontend-vue/package.json'), 'utf8'));

describe('project health checks', () => {
  test('root frontend deploy script points to the active Vue frontend deploy file', () => {
    expect(rootPackage.scripts['deploy:frontend']).toBe('bash deploy-frontend.sh');
    expect(fs.existsSync(path.resolve('deploy-frontend.sh'))).toBe(true);
  });

  test('root package uses combined api/web development scripts', () => {
    expect(rootPackage.scripts.dev).toBe('concurrently "npm:dev:api" "npm:dev:web"');
    expect(rootPackage.scripts['dev:web']).toBe('npm --prefix frontend-vue run dev');
  });

  test('vue frontend package exists with build and preview scripts', () => {
    expect(frontendVuePackage.name).toBe('frontend-vue');
    expect(frontendVuePackage.scripts.build).toBe('vue-tsc -b && vite build');
    expect(frontendVuePackage.scripts.preview).toBe('vite preview');
  });

  test('root package does not declare an unused next dependency', () => {
    expect(rootPackage.dependencies?.next).toBeUndefined();
  });

  test('logs directory exists for pm2 file output', () => {
    expect(fs.existsSync(path.resolve('logs'))).toBe(true);
  });
});
