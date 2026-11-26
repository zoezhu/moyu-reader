import type { Book, DisplayFormat, DocumentModel, ParkingZone, ReadingEncoding, ReadingSlot } from '../types';

type Format = Exclude<DisplayFormat, 'json'>;
type LineKind = 'header' | 'row' | 'cell' | 'code' | 'output' | 'status';
interface WorkLine { text: string; kind?: LineKind }
interface Carrier {
  before: WorkLine[];
  prefix: string;
  suffix: string;
  after: WorkLine[];
  encoding: ReadingEncoding;
  kind?: LineKind;
}

const modules = ['gateway', 'parser', 'scheduler', 'storage', 'adapter', 'export', 'validator', 'dispatcher'];
const checks = ['parameter validation', 'default value mapping', 'retry policy', 'output ordering', 'trace context', 'schema compatibility', 'resource cleanup', 'incremental recovery'];
const labels = ['参数校验', '缺省值回填', '重试策略', '输出顺序', '链路标识', '结构兼容', '资源释放', '增量恢复'];
const line = (text: string, kind?: LineKind): WorkLine => ({ text, ...(kind ? { kind } : {}) });
const lines = (values: string[], kind?: LineKind): WorkLine[] => values.map(text => line(text, kind));
const serial = (value: number) => String(value + 1).padStart(6, '0');

/** Every representation decodes to the exact original UTF-16 string. */
function encode(text: string, encoding: ReadingEncoding): string {
  if (encoding === 'json') return JSON.stringify(text);
  if (encoding === 'raw') return text;
  if (encoding === 'csv') return '"' + text.replace(/"/g, '""') + '"';
  if (encoding === 'sql') return "E'" + text.replace(/[\\'\n\r\t\b\f]/g, character => ({
    '\\': '\\\\', "'": "''", '\n': '\\n', '\r': '\\r', '\t': '\\t', '\b': '\\b', '\f': '\\f',
  })[character]!) + "'";
  return text.replace(/[&<>"'\n\r\t]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;', '\n': '&#10;', '\r': '&#13;', '\t': '&#9;',
  })[character]!);
}

function documentHeader(format: Format): WorkLine[] {
  switch (format) {
    case 'markdown': return lines(['---', 'team: platform', 'scope: integration', 'capacity: normal', 'risk: green', '---', '', '# 平台研发 · 集成验证记录', '', '## 核心交付', '', '- [Deploy] 测试环境已更新，当前进入接口联调。', '- [Review] 对齐输入结构与输出顺序，保留原始样例。', '']);
    case 'log': return lines(['2026-11-27T09:00:00.000Z INFO  bootstrap   service=validation-worker version=2.4.0', '2026-11-27T09:00:00.010Z INFO  workspace   environment=staging trace_enabled=true', '2026-11-27T09:00:00.016Z INFO  scheduler   concurrency=8 retry_limit=3 queue=integration']);
    case 'python': return lines(['"""Regression fixtures for the text processing gateway."""', 'import json', '', 'def validate(payload):', '    assert payload["schema_version"] == 2', '    assert isinstance(payload["input"], str)', '    return {"status": "accepted", "length": len(payload["input"])}', '']);
    case 'sql': return lines(['-- PostgreSQL · integration fixtures', 'BEGIN;', 'CREATE TEMP TABLE IF NOT EXISTS validation_samples (', '    id text PRIMARY KEY, content text NOT NULL, language text, status text', ');', 'CREATE INDEX IF NOT EXISTS idx_sample_status ON validation_samples (status);', '']);
    case 'yaml': return lines(['version: 2', 'workspace: integration', 'environment: staging', 'execution:', '  concurrency: 8', '  retry_limit: 3', '  timeout_ms: 30000', 'records:']);
    case 'xml': return lines(['<?xml version="1.0" encoding="UTF-8"?>', '<validation-workspace version="2" environment="staging">', '  <execution concurrency="8" retry-limit="3" timeout-ms="30000"/>', '  <records>']);
    case 'html': return lines(['<!doctype html>', '<html lang="zh-CN">', '<head>', '  <meta charset="UTF-8">', '  <meta name="viewport" content="width=device-width, initial-scale=1">', '  <title>Validation fixtures</title>', '</head>', '<body>', '<main class="validation-workspace" data-environment="staging">']);
    case 'dataset': return [line('sample_id,language,split,status,content', 'header')];
    case 'notebook': return [line('text_pipeline_validation.ipynb', 'header'), line('Python 3  ·  Kernel: idle  ·  Environment: staging', 'status'), line('In [1]:', 'cell'), ...lines(['from integration.fixtures import samples', 'from integration.validation import run_contract_checks, validate', 'schema_version = 2', 'batch_size = 32'], 'code'), line('Out [1]:', 'cell'), line('Workspace initialized · input validation enabled', 'output'), line('')];
    case 'tests': return [line('TEST EXPLORER  /  integration / text-pipeline', 'header'), line('Suite: schema_v2  ·  Runtime: Python 3  ·  Environment: staging', 'status'), line('Setup: fixtures loaded · parameter checks enabled', 'status'), line('')];
    case 'http': return [line('# Workspace: platform / integration', 'header'), line('@baseUrl = http://localhost:8080', 'code'), line('@schemaVersion = 2', 'code'), line('')];
  }
}

/** A caller may request no introductory padding; keep its small budget valid. */
function compactHeader(format: Format): WorkLine[] {
  switch (format) {
    case 'markdown': return lines(['# 平台研发 · 集成验证记录', '']);
    case 'python': return lines(['def validate(payload):', '    return {"status": "accepted", "length": len(payload["input"])}', '']);
    case 'yaml': return lines(['version: 2', 'records:']);
    case 'html': return lines(['<!doctype html>', '<html lang="zh-CN">', '<head><meta charset="UTF-8"><title>Validation fixtures</title></head>', '<body>', '<main class="validation-workspace">']);
    case 'notebook': return [line('text_pipeline_validation.ipynb', 'header'), line('from integration.fixtures import samples', 'code'), line('from integration.validation import run_contract_checks, validate', 'code')];
    default: return documentHeader(format);
  }
}

function documentFooter(format: Format): WorkLine[] {
  switch (format) {
    case 'markdown': return lines(['', '## 后续安排', '', '- [Plan] 扩充边界输入，复查异常分支。', '- [Review] 归档本轮记录，核对配置差异。']);
    case 'python': return lines(['', 'if __name__ == "__main__":', '    print("Run fixtures with the integration test runner.")']);
    case 'sql': return lines(['', 'SELECT status, count(*) AS sample_count FROM validation_samples GROUP BY status;', 'COMMIT;']);
    case 'yaml': return lines(['summary:', '  validation: enabled', '  preserve_input: true']);
    case 'xml': return lines(['  </records>', '  <summary validation="enabled" preserve-input="true"/>', '</validation-workspace>']);
    case 'html': return lines(['</main>', '</body>', '</html>']);
    case 'dataset': return [];
    case 'log': return lines(['2026-11-27T09:59:59.990Z INFO  scheduler   batch_state=ready diagnostics=0']);
    case 'notebook': return [line('In [ ]:', 'cell'), line('# Continue with the next validation batch.', 'code')];
    case 'tests': return [line('TEARDOWN  Fixture handles released · pending tasks: 0', 'status')];
    case 'http': return lines(['', '# Collection ready · next request available']);
  }
}

/** Wrappers add metadata around a sample, never words inside the original. */
function carrier(format: Format, index: number, source: string): Carrier {
  const id = 'sample_' + serial(index);
  const component = modules[index % modules.length];
  switch (format) {
    case 'markdown': {
      const fence = '`'.repeat(Math.max(3, ...Array.from(source.matchAll(/`+/g), match => match[0].length + 1)));
      return { before: lines(['', '### 样例复核 · ' + id, '- [Test][' + component + '] 校验分段边界与标点保留。', '- 输入记录：', fence + 'text']), prefix: '', suffix: '', after: lines([fence, '- [x] 类型检查与字符计数已完成。', '']), encoding: 'raw', kind: 'output' };
    }
    case 'log': return { before: lines([`2026-11-27T09:12:00.000Z INFO  ${component.padEnd(11)} task=${id} phase=validate`, `2026-11-27T09:12:00.005Z DEBUG schema      task=${id} version=2 preserve_input=true`]), prefix: `2026-11-27T09:12:00.008Z DEBUG sample      task=${id} input_preview=`, suffix: '', after: lines([`2026-11-27T09:12:00.019Z INFO  ${component.padEnd(11)} task=${id} status=accepted elapsed_ms=19`, `2026-11-27T09:12:00.021Z DEBUG trace       task=${id} diagnostics=0`]), encoding: 'json' };
    case 'python': return { before: lines(['', `def test_${id}():`, '    payload = {', `        "case_id": "${id}",`, '        "schema_version": 2,']), prefix: '        "input": ', suffix: ',', after: lines(['    }', '    result = validate(payload)', '    assert result["status"] == "accepted"', '    assert result["length"] == len(payload["input"])', '']), encoding: 'json' };
    case 'sql': return { before: lines(['', `-- Input fixture ${id} · ${component}`, 'INSERT INTO validation_samples (id, language, status, content) VALUES (', `    '${id}', 'zh', 'pending',`]), prefix: '    ', suffix: '', after: lines([') ON CONFLICT (id) DO NOTHING;', `SELECT id, length(content) AS text_length FROM validation_samples WHERE id = '${id}';`, '']), encoding: 'sql' };
    case 'yaml': return { before: lines([`  - id: ${id}`, `    component: ${component}`, '    kind: input_sample', '    schema_version: 2']), prefix: '    content: ', suffix: '', after: lines(['    language: zh', '    validation:', '      preserve_input: true', '      status: accepted']), encoding: 'json' };
    case 'xml': return { before: lines([`    <sample id="${id}" component="${component}" schema-version="2">`, '      <validation preserve-input="true" status="accepted"/>']), prefix: '      <content xml:space="preserve">', suffix: '</content>', after: lines(['      <language>zh</language>', '    </sample>']), encoding: 'xml' };
    case 'html': return { before: lines([`  <section class="sample-card" data-id="${id}">`, `    <header><h2>Input fixture · ${id}</h2></header>`, `    <div class="sample-meta" data-component="${component}">`, '      <span class="status">Accepted</span>', '    </div>']), prefix: '    <p class="sample-text">', suffix: '</p>', after: lines(['    <footer>Schema v2 · Input preserved</footer>', '  </section>', '']), encoding: 'xml' };
    case 'dataset': return { before: [], prefix: `${id},zh,validation,accepted,`, suffix: '', after: [], encoding: 'csv', kind: 'row' };
    case 'notebook': return { before: [line(`In [${index * 2 + 2}]:`, 'cell'), ...lines([`case_id = "${id}"`, 'record = samples.lookup(case_id)', 'validate(record, preserve_input=True)'], 'code'), line(`Out [${index * 2 + 2}]:`, 'cell')], prefix: '', suffix: '', after: [line(`status: accepted  ·  component: ${component}  ·  schema: 2`, 'status'), line('')], encoding: 'raw', kind: 'output' };
    case 'tests': return { before: [line(`PASS  ${component} / ${id}`, 'header'), line('  Case: preserve input across the normalization pipeline', 'row'), line('  Arrange: schema v2 · language zh · retries 3', 'row'), line('  Input sample:', 'cell')], prefix: '  ', suffix: '', after: [line('  Assertion: source characters preserved ✓', 'row'), line('  Assertion: output order stable ✓', 'row'), line(`  Duration: ${16 + index % 47} ms  ·  diagnostics: 0`, 'status'), line('')], encoding: 'raw', kind: 'output' };
    case 'http': return { before: [line(`### ${id} · Validate input`, 'header'), line('POST {{baseUrl}}/v2/samples/validate', 'code'), line('Content-Type: application/json', 'row'), line('Accept: application/json', 'row'), line(''), line('{', 'code'), line(`  "case_id": "${id}",`, 'code')], prefix: '  "input": ', suffix: ',', after: lines(['  "schema_version": 2', '}'], 'code'), encoding: 'json', kind: 'code' };
  }
}

/** Complete work records fill the JSON layout's existing work-only budgets. */
function workPacket(format: Format, index: number): WorkLine[] {
  const component = modules[index % modules.length];
  const check = checks[index % checks.length];
  const label = labels[index % labels.length];
  const id = serial(index);
  const passed = 24 + index % 29;
  const elapsed = 48 + index * 17 % 190;
  switch (format) {
    case 'markdown': return lines([
      `### ${component} · ${label}`, '',
      '- [Review] ' + label + '已覆盖，回归记录编号 `RUN-' + id + '`。',
      '- [Test] 已校验正常输入、缺省参数和异常返回。', '',
      '| 模块 | 用例 | 通过 | P95 / ms |', '| --- | ---: | ---: | ---: |',
      `| ${component} | ${passed} | ${passed} | ${elapsed} |`, '',
      '- [x] 请求结构与错误码一致。', '- [x] 输出顺序与链路日志一致。', '',
    ]);
    case 'log': return lines([
      `2026-11-27T09:01:${String(index % 60).padStart(2, '0')}.010Z INFO  ${component.padEnd(11)} run=RUN-${id} phase=started`,
      `2026-11-27T09:01:${String(index % 60).padStart(2, '0')}.012Z DEBUG configuration retry=3 timeout_ms=30000 concurrency=8`,
      `2026-11-27T09:01:${String(index % 60).padStart(2, '0')}.018Z INFO  validation  check="${check}" passed=${passed} failed=0`,
      `2026-11-27T09:01:${String(index % 60).padStart(2, '0')}.026Z DEBUG metrics     p95_ms=${elapsed} cache_hit=0.94`,
      `2026-11-27T09:01:${String(index % 60).padStart(2, '0')}.030Z INFO  ${component.padEnd(11)} run=RUN-${id} status=completed`,
    ]);
    case 'python': return lines([
      '', `def test_${component}_contract_${id}():`,
      '    options = {"timeout_ms": 30000, "retries": 3, "schema_version": 2}',
      `    result = {"module": "${component}", "passed": ${passed}, "failed": 0}`,
      '    assert options["timeout_ms"] > 0', '    assert result["failed"] == 0',
      `    assert result["passed"] == ${passed}`, `    # Coverage: ${check}`, '',
    ]);
    case 'sql': return lines([
      `-- Contract check ${id} · ${component}`, 'SELECT',
      `    '${component}' AS component, '${check}' AS check_name,`,
      `    ${passed} AS cases_passed, 0 AS cases_failed, ${elapsed} AS p95_ms;`,
      'SELECT id, language, status', 'FROM validation_samples',
      "WHERE status IN ('pending', 'accepted')", 'ORDER BY id LIMIT 32;', '',
    ]);
    case 'yaml': return lines([
      `  - id: check_${id}`, `    component: ${component}`, '    kind: contract_check',
      `    description: ${JSON.stringify(label)}`, '    options: {retry_limit: 3, timeout_ms: 30000}',
      `    metrics: {passed: ${passed}, failed: 0, p95_ms: ${elapsed}}`, '    status: completed',
    ]);
    case 'xml': return lines([
      `    <check id="check_${id}" component="${component}">`,
      `      <description>${label}</description>`, '      <options retry-limit="3" timeout-ms="30000"/>',
      `      <metrics passed="${passed}" failed="0" p95-ms="${elapsed}"/>`,
      '      <status>completed</status>', '    </check>',
    ]);
    case 'html': return lines([
      `  <section class="validation-result" data-run="${id}">`,
      `    <header><h2>${component} · ${label}</h2></header>`,
      '    <table class="metrics">', '      <thead><tr><th>Passed</th><th>Failed</th><th>P95 / ms</th></tr></thead>',
      `      <tbody><tr><td>${passed}</td><td>0</td><td>${elapsed}</td></tr></tbody>`,
      '    </table>', '    <footer>Status: completed</footer>', '  </section>',
    ]);
    case 'dataset': return [
      line(`check_${id},en,regression,passed,"${component}: ${check}; schema=v2"`, 'row'),
      line(`metric_${id},en,regression,passed,"cases=${passed}; failed=0; p95_ms=${elapsed}"`, 'row'),
      line(`config_${id},en,regression,ready,"retry_limit=3; timeout_ms=30000; concurrency=8"`, 'row'),
      line(`trace_${id},en,regression,complete,"RUN-${id}; trace_context=preserved; diagnostics=0"`, 'row'),
    ];
    case 'notebook': return [
      line(`In [${index + 100}]:`, 'cell'),
      ...lines([`module = "${component}"`, `result = run_contract_checks(module, check="${check}")`, 'result.summary()'], 'code'),
      line(`Out [${index + 100}]:`, 'cell'),
      line('component       passed  failed  p95_ms', 'header'),
      line(`${component.padEnd(16)}${String(passed).padEnd(8)}0       ${elapsed}`, 'row'),
      line(`Input contract: ${check}; schema_version=2; preserve_input=True`, 'output'),
      line('Validation completed · output order preserved', 'status'), line(''),
    ];
    case 'tests': return [
      line(`PASS  ${component} / contract_${id}`, 'header'),
      line(`  Test: ${check}`, 'row'),
      line('  Arrange: retry_limit=3 · timeout_ms=30000', 'row'),
      line(`  Input: {"component": "${component}", "schema_version": 2}`, 'output'),
      line('  Act: validate request schema and response order', 'row'),
      line(`  Assert: ${passed} checks passed · 0 failed`, 'row'),
      line(`  Duration: ${elapsed} ms · trace=RUN-${id}`, 'status'), line(''),
    ];
    case 'http': return [
      line(`### ${component} / Health and schema check`, 'header'),
      line(`GET {{baseUrl}}/v2/${component}/health`, 'code'),
      line('Accept: application/json', 'row'),
      line(`X-Request-ID: check-${id}`, 'row'), line(''),
      line(`# HTTP/1.1 200 OK · ${elapsed} ms`, 'status'),
      line(`# Content-Type: application/json · schema_version: 2`, 'row'),
      line(`# Validation: ${check} · passed=${passed}`, 'row'), line(''),
    ];
  }
}

/** Single-line records cover remainders without cutting a structured record. */
function remainderLine(format: Format, index: number): WorkLine {
  const component = modules[index % modules.length];
  const label = labels[index % labels.length];
  const id = serial(index);
  switch (format) {
    case 'markdown': return line(`- [Check][${component}] ${label} · RUN-${id} · 已完成`);
    case 'log': return line(`2026-11-27T09:02:00.020Z INFO  ${component.padEnd(11)} check=${id} status=ok diagnostics=0`);
    case 'python': return line(`# ${component}: ${checks[index % checks.length]} verified · RUN-${id}`);
    case 'sql': return line(`-- ${component}: ${checks[index % checks.length]} verified · RUN-${id}`);
    case 'yaml': return line(`  # ${component}: ${label} · RUN-${id}`);
    case 'xml': return line(`    <check-ref id="${id}" component="${component}" status="verified"/>`);
    case 'html': return line(`  <div class="check-reference" data-id="${id}">${component}: ${label} · verified</div>`);
    case 'dataset': return line(`check_${id},zh,regression,passed,"${component}: ${label}"`, 'row');
    case 'notebook': return line(`  ${component.padEnd(12)} ${checks[index % checks.length]} · verified`, 'row');
    case 'tests': return line(`  ✓ ${component} / ${label} · RUN-${id}`, 'row');
    case 'http': return line(`# ${component}: ${checks[index % checks.length]} · RUN-${id}`, 'row');
  }
}

/**
 * Reuse the JSON layout as a schedule, not as content. Every gap retains exactly
 * its original number of work lines. Newlines belonging to the source may add
 * physical lines, but never alter its chunk boundaries, order, or source offsets.
 */
export function formatDocument(base: DocumentModel, book: Book, format: Format): DocumentModel {
  const output: string[] = [];
  const slots: ReadingSlot[] = [];
  const lineStyles: NonNullable<DocumentModel['lineStyles']> = [];
  let offset = 0;
  let nextLine = 1;
  let workIndex = base.windowStart * 37;
  // Each input sample owns a stable minute on the timeline, even after paging
  // into an overlapping window. Work lines share the interval before it.
  let logAnchor = base.windowStart * 60_000;
  let logLineSpacing = 0;
  let logLineIndex = 0;
  const timestamp = (text: string) => format === 'log'
    ? text.replace(/^2026-11-27T[\d:.]+Z/, new Date(Date.UTC(2026, 10, 27, 9) + Math.round(logAnchor + ++logLineIndex * logLineSpacing)).toISOString())
    : text;

  const appendWork = (work: WorkLine[]) => {
    for (const item of work) {
      if (item.kind) lineStyles.push({ line: nextLine, kind: item.kind });
      const text = timestamp(item.text);
      output.push(text + '\n');
      offset += text.length + 1;
      nextLine++;
    }
  };
  const fillWork = (count: number) => {
    while (count > 0) {
      const packet = workPacket(format, workIndex++);
      if (packet.length <= count) { appendWork(packet); count -= packet.length; }
      else {
        // Packet size is fixed for each format. Once it no longer fits, avoid
        // rebuilding and discarding the same packet for every remaining line.
        while (count > 0) { appendWork([remainderLine(format, workIndex++)]); count--; }
      }
    }
  };
  const appendGap = (budget: number, leading: WorkLine[], trailing: WorkLine[], nextLogAnchor = logAnchor + 60_000) => {
    // Current compact JSON carriers leave at least 14 work lines. The largest
    // format wrapper uses 12, so all syntax closes before a following wrapper.
    if (leading.length + trailing.length > budget) throw new Error('Display wrapper exceeds the shared reading layout.');
    logLineSpacing = (nextLogAnchor - logAnchor) / (budget + 1);
    logLineIndex = 0;
    appendWork(leading);
    fillWork(budget - leading.length - trailing.length);
    appendWork(trailing);
  };
  let previousLine = 0;
  let previousAfter = documentHeader(format);
  for (const slot of base.slots) {
    const source = book.text.slice(slot.sourceStart, slot.sourceEnd);
    const template = carrier(format, slot.chunkIndex, source);
    if (previousLine === 0 && previousAfter.length + template.before.length > slot.line - 1) previousAfter = compactHeader(format);
    const nextLogAnchor = (slot.chunkIndex + 1) * 60_000;
    appendGap(slot.line - previousLine - 1, previousAfter, template.before, nextLogAnchor);
    const encoded = encode(source, template.encoding);
    const prefix = timestamp(template.prefix);
    const fullText = prefix + encoded + template.suffix;
    const extraLines = (fullText.match(/\n/g) ?? []).length;
    const startLine = nextLine;
    if (template.kind) {
      for (let index = 0; index <= extraLines; index++) lineStyles.push({ line: nextLine + index, kind: template.kind });
    }
    slots.push({
      ...slot,
      from: offset + prefix.length,
      to: offset + prefix.length + encoded.length,
      line: startLine,
      endLine: startLine + extraLines,
      encoding: template.encoding,
    });
    output.push(fullText + '\n');
    offset += fullText.length + 1;
    nextLine += extraLines + 1;
    previousLine = slot.line;
    previousAfter = template.after;
    logAnchor = nextLogAnchor;
  }
  const baseLineCount = base.text.split('\n').length - 1;
  appendGap(baseLineCount - previousLine, previousAfter, documentFooter(format));
  const parkingZones: ParkingZone[] = [];
  let zoneStart = 1;
  for (const slot of slots) {
    if (slot.line > zoneStart) parkingZones.push({ startLine: zoneStart, endLine: slot.line - 1 });
    zoneStart = (slot.endLine ?? slot.line) + 1;
  }
  if (zoneStart < nextLine) parkingZones.push({ startLine: zoneStart, endLine: nextLine - 1 });
  return { ...base, format, text: output.join(''), slots, parkingZones, lineStyles };
}
