import { useEffect, useState } from 'react';
import { AlertTriangleIcon, XIcon } from 'lucide-react';
import { WorkspaceConflict } from '../../types';
import { useDialogAccessibility } from '../../hooks/useDialogAccessibility';

interface WorkspaceConflictModalProps {
  conflicts: WorkspaceConflict[];
  onUseExternal: () => Promise<void> | void;
  onKeepCurrent: () => Promise<void> | void;
  onMerge: (path: string, content: string) => Promise<void> | void;
  onClose: () => void;
}

export function WorkspaceConflictModal({
  conflicts,
  onUseExternal,
  onKeepCurrent,
  onMerge,
  onClose
}: WorkspaceConflictModalProps) {
  const dialogRef = useDialogAccessibility(onClose);
  const [selectedPath, setSelectedPath] = useState(conflicts[0]?.path || '');
  const [busy, setBusy] = useState<'external' | 'current' | 'merge' | ''>('');
  const [isMerging, setIsMerging] = useState(false);
  const [mergedContent, setMergedContent] = useState(conflicts[0]?.proposedContent || '');
  const selected = conflicts.find((item) => item.path === selectedPath) || conflicts[0];

  useEffect(() => {
    setMergedContent(selected?.proposedContent || selected?.externalContent || '');
    setIsMerging(false);
  }, [selectedPath]);

  const run = async (kind: 'external' | 'current' | 'merge', action: () => Promise<void> | void) => {
    setBusy(kind);
    try {
      await action();
    } finally {
      setBusy('');
    }
  };

  if (!selected) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.48)', backdropFilter: 'blur(5px)' }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-conflict-title"
        className="w-full max-w-5xl rounded-2xl overflow-hidden"
        style={{ background: '#FFFFFF', boxShadow: '0 32px 80px rgba(0,0,0,0.2)' }}
      >
        <div className="flex items-start justify-between px-6 py-4" style={{ borderBottom: '1px solid #EAEAEA' }}>
          <div className="flex gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: '#FFF5E8' }}>
              <AlertTriangleIcon size={18} color="#C67A1B" />
            </div>
            <div>
              <h2 id="workspace-conflict-title" className="text-base" style={{ color: '#1A1A2E' }}>
                发现外部修改，保存已暂停
              </h2>
              <p className="text-xs mt-1" style={{ color: '#8B8B9E' }}>
                请比较两边内容后选择。应用不会自动覆盖任何一版。
              </p>
            </div>
          </div>
          <button aria-label="关闭冲突对照" onClick={onClose} className="p-2 rounded-lg" style={{ color: '#8B8B9E' }}>
            <XIcon size={16} />
          </button>
        </div>

        {conflicts.length > 1 && (
          <div className="px-6 py-3 flex gap-2 overflow-x-auto" style={{ borderBottom: '1px solid #EAEAEA' }}>
            {conflicts.map((item) => (
              <button
                key={item.path}
                onClick={() => setSelectedPath(item.path)}
                className="px-3 py-1.5 rounded-lg text-xs whitespace-nowrap"
                style={{
                  background: item.path === selected.path ? '#EEF3FF' : '#F7F7F8',
                  color: item.path === selected.path ? '#2E5BD1' : '#6E6E8A'
                }}
              >
                {item.path}
              </button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 min-h-[420px] max-h-[58vh]">
          <section className="flex flex-col min-w-0" style={{ borderRight: '1px solid #EAEAEA' }}>
            <div className="px-5 py-3 text-xs" style={{ background: '#F7F7F8', color: '#6E6E8A' }}>
              外部文件：{selected.path}
            </div>
            <pre className="flex-1 overflow-auto p-5 text-xs whitespace-pre-wrap" style={{ color: '#2A2A3E', lineHeight: 1.7 }}>
              {selected.externalContent || '文件已被删除'}
            </pre>
          </section>
          <section className="flex flex-col min-w-0">
            <div className="px-5 py-3 text-xs" style={{ background: '#F7F7F8', color: '#6E6E8A' }}>
              应用内准备保存的版本
            </div>
            <pre className="flex-1 overflow-auto p-5 text-xs whitespace-pre-wrap" style={{ color: '#2A2A3E', lineHeight: 1.7 }}>
              {selected.proposedContent || '应用内版本为空'}
            </pre>
          </section>
        </div>

        {isMerging && (
          <div className="px-6 py-4" style={{ borderTop: '1px solid #EAEAEA', background: '#FAFAFA' }}>
            <label htmlFor="workspace-merged-content" className="text-xs" style={{ color: '#4A4A6A' }}>
              合并后的最终内容
            </label>
            <textarea
              id="workspace-merged-content"
              value={mergedContent}
              onChange={(event) => setMergedContent(event.target.value)}
              rows={8}
              className="w-full mt-2 p-3 rounded-lg resize-y text-xs outline-none"
              style={{ border: '1.5px solid #B8C7F5', background: '#FFFFFF', color: '#2A2A3E', lineHeight: 1.7 }}
            />
          </div>
        )}

        <div className="flex items-center justify-end gap-3 px-6 py-4" style={{ borderTop: '1px solid #EAEAEA' }}>
          <button
            onClick={() => void run('external', onUseExternal)}
            disabled={Boolean(busy)}
            className="px-4 py-2 rounded-lg text-sm"
            style={{ border: '1px solid #D8D8E8', color: '#4A4A6A', background: '#FFFFFF' }}
          >
            {busy === 'external' ? '载入中...' : '采用外部版本'}
          </button>
          <button
            onClick={() => {
              if (!isMerging) {
                setIsMerging(true);
                return;
              }
              void run('merge', () => onMerge(selected.path, mergedContent));
            }}
            disabled={Boolean(busy)}
            className="px-4 py-2 rounded-lg text-sm"
            style={{ border: '1px solid #B8C7F5', color: '#2E5BD1', background: '#F7F9FF' }}
          >
            {busy === 'merge' ? '合并中...' : isMerging ? '采用合并版本' : '对照合并'}
          </button>
          <button
            onClick={() => void run('current', onKeepCurrent)}
            disabled={Boolean(busy)}
            className="px-4 py-2 rounded-lg text-sm"
            style={{ background: '#1A1A2E', color: '#FFFFFF' }}
          >
            {busy === 'current' ? '保存中...' : '保留应用内版本'}
          </button>
        </div>
      </div>
    </div>
  );
}
