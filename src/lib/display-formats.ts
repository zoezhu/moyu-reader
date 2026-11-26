import type { DisplayFormat } from '../types';

export interface DisplayFormatInfo {
  id: DisplayFormat;
  label: string;
  extension: string;
  language: string;
  icon: string;
  description: string;
}

export const DISPLAY_FORMATS: readonly DisplayFormatInfo[] = [
  { id: 'json', label: 'JSON 配置', extension: '.json', language: 'JSON', icon: '{}', description: '接口配置、参数约束与 default 样例' },
  { id: 'markdown', label: 'Markdown 周报', extension: '.md', language: 'Markdown', icon: '↓', description: '任务进展、验证记录、指标与检查清单' },
  { id: 'log', label: '运行日志', extension: '.log', language: 'Log', icon: '≡', description: '请求链路、批处理任务与输入样例' },
  { id: 'python', label: 'Python 测试', extension: '.py', language: 'Python', icon: 'Py', description: '测试函数、输入数据与回归断言' },
  { id: 'sql', label: 'SQL 脚本', extension: '.sql', language: 'SQL', icon: 'DB', description: '表结构、样例写入与验证查询' },
  { id: 'yaml', label: 'YAML 配置', extension: '.yaml', language: 'YAML', icon: 'Y', description: '任务参数、环境设置与样例配置' },
  { id: 'xml', label: 'XML 报文', extension: '.xml', language: 'XML', icon: '<>', description: '请求节点、属性与输入数据' },
  { id: 'html', label: 'HTML 模板', extension: '.html', language: 'HTML', icon: '<>', description: '组件结构、页面模板与文本样例' },
  { id: 'dataset', label: '数据集表格', extension: '.csv', language: 'CSV', icon: '▦', description: '样本编号、文本、语言与处理状态' },
  { id: 'notebook', label: 'Notebook 实验', extension: '.ipynb', language: 'Notebook', icon: 'NB', description: '处理代码、样例输出与实验记录' },
  { id: 'tests', label: '测试报告', extension: '.test', language: 'Test Report', icon: '✓', description: '用例详情、输入记录、断言与耗时' },
  { id: 'http', label: '接口调试', extension: '.http', language: 'HTTP', icon: '↔', description: '请求参数、响应数据与链路信息' },
];

export function isDisplayFormat(value: unknown): value is DisplayFormat {
  return typeof value === 'string' && DISPLAY_FORMATS.some(format => format.id === value);
}

export function getDisplayFormat(value: DisplayFormat | string): DisplayFormatInfo {
  return DISPLAY_FORMATS.find(format => format.id === value) ?? DISPLAY_FORMATS[0];
}

/** The stored alias remains intact; only its displayed extension follows the view. */
export function displayFileName(alias: string, format: DisplayFormat): string {
  const base = alias.replace(/\.(?:json|md|log|py|sql|ya?ml|xml|html?|csv|ipynb|test|http)$/i, '');
  return (base || 'workspace') + getDisplayFormat(format).extension;
}
