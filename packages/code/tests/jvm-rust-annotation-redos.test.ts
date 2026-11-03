import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

import { JvmSpringSemanticAdapter, RustSemanticAdapter } from '../src/adapters/multi-language-regex.js';
import type { PendingRelation } from '../src/adapters/types.js';

const attacks = [
  ['Spring inline annotations', 'java', '@A' + '\t\t@A'.repeat(32) + '!'],
  ['Spring method annotations', 'kotlin', '@Bean\n@A' + ' @A'.repeat(32) + '!'],
  ['Spring Java return type whitespace', 'java', '@Bean\nA' + ' '.repeat(100_000) + '!'],
  ['JVM annotation lines', 'java', '@A\n'.repeat(50_000) + '!'],
  ['JVM method return type whitespace', 'java', 'A' + ' '.repeat(100_000) + '!'],
  ['Rust blank lines and attributes', 'rust', '#[test]\n#[]' + '\n\n#[]'.repeat(40) + '!'],
  ['Rust repeated test attributes', 'rust', '#[test]\n'.repeat(20_000) + '!'],
  ['JVM unclosed annotation arguments', 'java', '@A(\n'.repeat(20_000) + '!'],
  ['Spring repeated Bean annotations', 'java', '@Bean\n'.repeat(20_000) + '!'],
  ['Spring unclosed Bean arguments', 'java', '@Bean(\n'.repeat(20_000) + '!'],
  ['Spring repeated method mappings', 'java', '@RestController\nclass Input {\n' + '@GetMapping\n'.repeat(20_000) + '!\n}'],
  ['JVM multiline return type', 'java', 'A\n'.repeat(50_000) + '!']
] as const;

for (const [name, language, content] of attacks) {
  test(`${name} extraction terminates on malformed prefixes`, () => {
    const script = `
      import { readFileSync } from 'node:fs';
      import { JvmSpringSemanticAdapter, RustSemanticAdapter } from './src/adapters/multi-language-regex.ts';
      const { language, content } = JSON.parse(readFileSync(0, 'utf8'));
      const extension = language === 'rust' ? 'rs' : language === 'kotlin' ? 'kt' : 'java';
      const relativePath = language === 'rust' ? 'tests/input_test.rs' : 'tests/inputTest.' + extension;
      const file = { absolutePath: '/repo/' + relativePath, relativePath,
        language, content, hash: 'annotation-regression' };
      const source = { ...file, relativePath: 'src/input.' + extension, content: '' };
      const files = [file, source];
      const adapter = language === 'rust' ? new RustSemanticAdapter() : new JvmSpringSemanticAdapter();
      const run = adapter.start({ repoRoot: '/repo', indexRunId: 1, adapterRunId: 1, indexedFiles: files }, files);
      let verifies = 0;
      for await (const event of run.process(file)) {
        if (event.kind === 'relation' && event.relation.kind === 'VERIFIES') verifies++;
      }
      console.log(JSON.stringify({ verifies }));
    `;
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
      input: JSON.stringify({ language, content }), encoding: 'utf8', timeout: 5000, env
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(JSON.parse(result.stdout).verifies > 0, 'filename inference must reach declaration evidence extraction');
  });
}

const validFixtures: Array<{
  name: string;
  language: string;
  content: string;
  expected: Array<[string, string, number, number, number, number]>;
}> = [
  {
    name: 'repeated Spring annotations and multiline Java return types', language: 'java',
    content: '@RestController @RequestMapping("/root")\npublic class Example {\n  @GetMapping("/a")\n  @PostMapping(path = "/b")\n  @Other(\n    "value")\n  public java.util.Map<String, java.util.List<Item[]>>[]\n      handle (String id) { return null; }\n  @Bean(name = "one")\n  @Bean\n  protected static Foo bean () { return null; }\n}',
    expected: [
      ['spring:RestController:Example', '', 1, 2, 1, 23],
      ['spring:endpoint:Example.handle', '/root/a', 3, 8, 3, 42],
      ['spring:endpoint:Example.handle', '/root/a', 3, 8, 3, 42],
      ['spring:endpoint:Example.handle', '/root/b', 4, 8, 3, 42],
      ['spring:endpoint:Example.handle', '/root/b', 4, 8, 3, 42],
      ['spring:Bean:bean', '', 9, 11, 3, 48],
      ['spring:Bean:bean', '', 10, 11, 3, 48],
      ['test import/name', '', 1, 2, 1, 23]
    ]
  },
  {
    name: 'qualified Kotlin annotations and multiline modifiers', language: 'kotlin',
    content: '@org.example.RestController\n@RequestMapping(\n  path = ["/k"])\ninternal open class Example {\n  @GetMapping("/ping") @Other\n  internal override suspend fun ping\n    (): String = ""\n}',
    expected: [
      ['spring:RestController:Example', '', 1, 4, 1, 30],
      ['spring:endpoint:Example.ping', '/k/ping', 5, 6, 3, 37],
      ['spring:endpoint:Example.ping', '/k/ping', 5, 6, 3, 37],
      ['test import/name', '', 1, 4, 1, 30]
    ]
  },
  {
    name: 'inline RequestMapping method evidence', language: 'java',
    content: '@RestController public class Example {\n  @RequestMapping(path = "/inline", method = RequestMethod.GET) @Other public String inline() { return ""; }\n}',
    expected: [
      ['spring:RestController:Example', '', 1, 1, 1, 39],
      ['spring:endpoint:Example.inline', '/inline', 2, 2, 3, 109],
      ['spring:endpoint:Example.inline', '/inline', 2, 2, 3, 109],
      ['test import/name', '', 1, 1, 1, 39]
    ]
  },
  {
    name: 'JVM class evidence priority over an earlier function', language: 'kotlin',
    content: '@Test\nfun early() {}\n@Suite(\n  "value")\ninternal\nopen class InputTest {}',
    expected: [['test import/name', '', 3, 6, 1, 24]]
  },
  {
    name: 'JVM method-only evidence with generic return types', language: 'java',
    content: '@Test\n@Other(value = "x")\nprotected static java.util.Map<String, ? extends Item[]>[]\n    verifiesInput\n    (String id) {}',
    expected: [['test import/name', '', 1, 5, 1, 19]]
  },
  {
    name: 'Rust test attributes with blank lines and visibility', language: 'rust',
    content: 'fn test_fallback() {}\n#[test]\n\n#[cfg(feature = "x")]\n\n#[allow(dead_code)]\npub(crate)\nasync fn checks_input\n    () {}',
    expected: [['test import/name', '', 2, 9, 1, 10]]
  },
  {
    name: 'Rust named test fallback with attributes', language: 'rust',
    content: '#[allow(dead_code)]\npub(crate) async fn input_test\n  () {}',
    expected: [['test import/name', '', 1, 3, 1, 8]]
  }
];

for (const { name, language, content, expected } of validFixtures) {
  test(`preserves ${name}`, async () => {
    const relations = (await publicRelations(language, content)).filter((relation) =>
      relation.kind === 'VERIFIES' || String(relation.metadata?.provenance).startsWith('spring:')
    );
    assert.deepEqual(relations.map((relation) => {
      const evidence = relation.evidence?.[0];
      assert.ok(evidence, 'expected bounded declaration evidence');
      return [relation.metadata?.provenance, relation.target.metadata?.routePath ?? '',
        evidence.startLine, evidence.endLine, evidence.startCol, evidence.endCol];
    }), expected);
    for (const [index, [, , startLine, endLine]] of expected.entries()) {
      assert.equal(relations[index]!.evidence?.[0]?.snippet,
        content.split('\n').slice(startLine - 1, endLine).join('\n').trim());
    }
  });
}

async function publicRelations(language: string, content: string): Promise<PendingRelation[]> {
  const extension = language === 'rust' ? 'rs' : language === 'kotlin' ? 'kt' : 'java';
  const relativePath = language === 'rust' ? 'tests/input_test.rs' : 'tests/inputTest.' + extension;
  const file = { absolutePath: '/repo/' + relativePath, relativePath, language, content, hash: 'valid' };
  const source = { ...file, relativePath: 'src/input.' + extension, content: '' };
  const files = [file, source];
  const adapter = language === 'rust' ? new RustSemanticAdapter() : new JvmSpringSemanticAdapter();
  const run = adapter.start({ repoRoot: '/repo', indexRunId: 1, adapterRunId: 1, indexedFiles: files }, files);
  const result: PendingRelation[] = [];
  for await (const event of run.process(file)) {
    if (event.kind === 'relation') result.push(event.relation);
  }
  return result;
}
