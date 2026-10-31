const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '../../../..');
const runtimeSource = fs.readFileSync(
  path.join(projectRoot, 'api/app/clients/BaseClient.js'),
  'utf8',
);
const packagingSource = fs.readFileSync(
  path.join(projectRoot, 'patches/api-app-clients-BaseClient.js'),
  'utf8',
);
const librechatConfig = fs.readFileSync(path.join(projectRoot, 'librechat.yaml'), 'utf8');

describe('SanSuo fixed self-introduction', () => {
  test.each([
    ['runtime source', runtimeSource],
    ['packaging source', packagingSource],
  ])('%s describes all answer modes and manual-only memory', (_label, source) => {
    expect(source).toContain('快速模式：适合普通问答');
    expect(source).toContain('深度模式：适合复杂分析');
    expect(source).toContain('知识库模式：适合查询已接入的内部知识资料');
    expect(source).toContain('结合用户手工维护的长期记忆');
    expect(source).toContain('输入框旁的“记忆模式”');
    expect(source).not.toContain('用户可以说“记住……”');
    expect(source).not.toContain('也可以说“忘记……”');
  });

  test('main configuration keeps the same three-mode and manual-memory contract', () => {
    expect(librechatConfig).toContain('快速模式适合普通问答');
    expect(librechatConfig).toContain('深度模式适合复杂分析');
    expect(librechatConfig).toContain('知识库模式适合查询已接入的内部知识资料');
    expect(librechatConfig).toContain('结合用户手工维护的长期记忆');
    expect(librechatConfig).toContain('输入框旁的“记忆模式”');
  });
});
