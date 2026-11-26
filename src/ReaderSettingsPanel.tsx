import { CircleHelp } from 'lucide-react';
import { FormatSelect } from './DisplayFormatControls';
import { getDisplayFormat } from './lib/display-formats';
import { READING_SHORTCUTS, readingKeyFromEvent, readingKeyLabel } from './lib/reading-shortcut';
import type { ReaderSettings } from './types';

interface Props {
  settings: ReaderSettings;
  onChange: (update: Partial<ReaderSettings>) => void;
  onShortcutChange: (update: Partial<Pick<ReaderSettings, 'readingKey' | 'previousReadingKey'>>) => void;
  notify: (message: string) => void;
  onHelp: () => void;
}

const workspaceOptions = [
  { key: 'showChapterTitles', label: '显示原始章节标题', hint: '关闭时，大纲仅显示 section 编号' },
  { key: 'showSidebar', label: '显示资源管理器', hint: '文件列表与章节大纲' },
  { key: 'showOutput', label: '显示输出面板', hint: '本地解析与存储信息' },
] as const;

export function ReaderSettingsPanel({ settings, onChange, onShortcutChange, notify, onHelp }: Props) {
  return (
    <div className="modal-content">
      <div className="settings-section">
        <h3>编辑器</h3>
        <div className="settings-row">
          <span><strong>显示格式</strong><small>{getDisplayFormat(settings.displayFormat).description}。切换时保留阅读位置。</small></span>
          <FormatSelect value={settings.displayFormat} onChange={displayFormat => onChange({ displayFormat })} />
        </div>
        <label className="settings-row">
          <span><strong>文字大小</strong><small>正文与周围工作内容使用相同字号</small></span>
          <span className="font-setting">
            <input
              className="range-input"
              type="range"
              aria-label="文字大小"
              min={13}
              max={22}
              value={settings.fontSize}
              onChange={event => onChange({ fontSize: Number(event.target.value) })}
            />
            <span>{settings.fontSize}px</span>
          </span>
        </label>
        <label className="settings-row">
          <span><strong>阅读节奏</strong><small>各格式共用短正文片段和工作内容间隔</small></span>
          <select
            className="select-input"
            aria-label="阅读节奏"
            value={settings.density}
            onChange={event => onChange({ density: event.target.value as ReaderSettings['density'] })}
          >
            <option value="comfortable">阅读优先</option>
            <option value="sparse">均衡穿插</option>
            <option value="extra-sparse">工作内容较多</option>
          </select>
        </label>
        {READING_SHORTCUTS.map(shortcut => (
          <div className="settings-row" key={shortcut.key}>
            <span>
              <strong>{shortcut.label}</strong>
              <small id={shortcut.key + '-hint'}>
                默认 {readingKeyLabel(shortcut.defaultKey)}，将{shortcut.target}正文的第一行贴齐顶部。点击右侧后可改为字母、数字或空格。
              </small>
            </span>
            <span className="shortcut-setting">
              <input
                className="text-input shortcut-input"
                aria-label={shortcut.label}
                aria-describedby={shortcut.key + '-hint'}
                readOnly
                value={readingKeyLabel(settings[shortcut.key])}
                onFocus={event => event.currentTarget.select()}
                onKeyDown={event => {
                  const key = readingKeyFromEvent(event.nativeEvent);
                  if (key === null) return;
                  event.preventDefault();
                  if (key === settings[shortcut.other]) {
                    notify('上下跳转不能使用同一个按键，请换一个。');
                    return;
                  }
                  onShortcutChange({ [shortcut.key]: key });
                }}
              />
              <button
                className="button subtle"
                disabled={settings[shortcut.key] === shortcut.defaultKey}
                onClick={() => {
                  if (shortcut.defaultKey === settings[shortcut.other]) {
                    notify('该默认键已用于另一个方向，请先修改另一个跳转键。');
                    return;
                  }
                  onShortcutChange({ [shortcut.key]: shortcut.defaultKey });
                }}
              >
                恢复 {readingKeyLabel(shortcut.defaultKey)}
              </button>
            </span>
          </div>
        ))}
      </div>
      <div className="settings-section">
        <h3>工作区</h3>
        {workspaceOptions.map(option => (
          <label className="settings-row" key={option.key}>
            <span><strong>{option.label}</strong><small>{option.hint}</small></span>
            <input
              type="checkbox"
              className="toggle"
              checked={settings[option.key]}
              onChange={event => onChange({ [option.key]: event.target.checked })}
            />
          </label>
        ))}
      </div>
      <button className="button subtle" onClick={onHelp}>
        <CircleHelp size={15} />查看快捷键与说明
      </button>
    </div>
  );
}
