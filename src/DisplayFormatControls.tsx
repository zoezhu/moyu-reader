import { useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { DISPLAY_FORMATS, getDisplayFormat, isDisplayFormat } from './lib/display-formats';
import type { DisplayFormat } from './types';

interface FormatSelectProps {
  value: DisplayFormat;
  onChange: (format: DisplayFormat) => void;
  compact?: boolean;
  label?: string;
}

export function FormatSelect({ value, onChange, compact = false, label = '显示格式' }: FormatSelectProps) {
  const pointerSelection = useRef(false);
  const keyboardChanged = useRef(false);
  return <span className={compact ? 'format-picker' : 'format-setting-picker'}>
    <select
      className={compact ? 'format-select' : 'select-input'}
      aria-label={label}
      value={value}
      onPointerDown={() => { pointerSelection.current = true; }}
      onKeyDown={event => {
        pointerSelection.current = false;
        if (compact && (event.key === 'Escape' || (event.key === 'Enter' && keyboardChanged.current))) {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.blur();
        }
      }}
      onBlur={() => { pointerSelection.current = false; keyboardChanged.current = false; }}
      onChange={event => {
        if (!isDisplayFormat(event.target.value)) return;
        onChange(event.target.value);
        keyboardChanged.current = !pointerSelection.current;
        // A mouse selection is complete: leave the native control so Z/E work
        // immediately. Keyboard arrows keep focus for continued option browsing.
        if (compact && pointerSelection.current) event.currentTarget.blur();
      }}
    >
      {DISPLAY_FORMATS.map(format => <option key={format.id} value={format.id}>{format.label}</option>)}
    </select>
    {compact && <ChevronDown size={13} aria-hidden="true" />}
  </span>;
}

export function FormatIcon({ format }: { format: DisplayFormat }) {
  return <span className={'format-file-icon format-icon-' + format} aria-hidden="true">{getDisplayFormat(format).icon}</span>;
}

export function FormatContextBar({ format }: { format: DisplayFormat }) {
  if (format === 'dataset') return <>
    <div className="format-context" aria-label="数据集视图信息"><span className="format-context-title">DATASET</span><span>UTF-8 · CSV</span><span>按原始顺序</span><span className="format-context-end">自动换行</span></div>
    <div className="dataset-column-header" aria-label="数据表列名">
      <span className="dataset-header-gutter">#</span>
      <span className="dataset-header-id">sample_id</span>
      <span className="dataset-header-language">lang</span>
      <span className="dataset-header-split">split</span>
      <span className="dataset-header-status">status</span>
      <span className="dataset-header-content">content</span>
    </div>
  </>;
  if (format === 'notebook') return <div className="format-context" aria-label="Notebook 视图信息"><span className="format-context-title">NOTEBOOK</span><span>Python 3</span><span>代码与输出</span><span className="format-context-end">只读</span></div>;
  if (format === 'tests') return <div className="format-context" aria-label="测试报告视图信息"><span className="format-context-title">TEST RESULTS</span><span>验证记录</span><span>输入 · 断言 · 结果</span></div>;
  if (format === 'http') return <div className="format-context http-context" aria-label="接口调试视图信息"><span className="http-method">POST</span><code>{'{{baseUrl}}/v2/samples/validate'}</code><span className="format-context-end">请求 / 响应</span></div>;
  if (format === 'log') return <div className="format-context" aria-label="日志视图信息"><span className="format-context-title">OUTPUT</span><span>validation-worker</span><span className="format-context-end">自动换行</span></div>;
  return null;
}

export const formatFolder: Record<DisplayFormat, string> = {
  json: 'responses', markdown: 'reports', log: 'logs', python: 'tests', sql: 'queries',
  yaml: 'config', xml: 'schemas', html: 'templates', dataset: 'datasets',
  notebook: 'notebooks', tests: 'reports', http: 'requests',
};
