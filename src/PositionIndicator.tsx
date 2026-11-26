import { forwardRef, useImperativeHandle, useState } from 'react';

export interface PositionIndicatorHandle {
  update: (line: number) => void;
}

// Scroll reports can arrive every frame. Only this small label needs to render
// when the line changes; the workspace and editor keep their existing tree.
export const PositionIndicator = forwardRef<PositionIndicatorHandle, { onLocate: () => void }>(function PositionIndicator({ onLocate }, ref) {
  const [line, setLine] = useState(1);
  useImperativeHandle(ref, () => ({ update: setLine }), []);
  return <button className="status-item" title="定位符号" onClick={onLocate}>Ln {line}, Col 1</button>;
});
