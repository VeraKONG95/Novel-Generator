import { useMemo, useState } from 'react';
import { CheckIcon, DownloadIcon, FileTextIcon, RotateCcwIcon, XIcon } from 'lucide-react';
import { Chapter } from '../../types';
import { useDialogAccessibility } from '../../hooks/useDialogAccessibility';

export interface ExportSelection {
  includeOutline: boolean;
  chapterIds: string[];
}

interface ExportModalProps {
  outlineAvailable: boolean;
  chapters: Chapter[];
  onExport: (selection: ExportSelection) => Promise<void> | void;
  onClose: () => void;
}

export function ExportModal({
  outlineAvailable,
  chapters,
  onExport,
  onClose
}: ExportModalProps) {
  const dialogRef = useDialogAccessibility(onClose);
  const [includeOutline, setIncludeOutline] = useState(outlineAvailable);
  const [selectedChapterIds, setSelectedChapterIds] = useState<string[]>(chapters.map((chapter) => chapter.id));
  const [isExporting, setIsExporting] = useState(false);

  const selectedCount = selectedChapterIds.length + (includeOutline ? 1 : 0);
  const allSelected = selectedChapterIds.length === chapters.length && (!outlineAvailable || includeOutline);

  const selectedWordCount = useMemo(() => {
    const selectedSet = new Set(selectedChapterIds);
    return chapters.reduce(
      (sum, chapter) => sum + (selectedSet.has(chapter.id) ? chapter.wordCount : 0),
      0
    );
  }, [chapters, selectedChapterIds]);

  const toggleChapter = (chapterId: string) => {
    setSelectedChapterIds((current) =>
      current.includes(chapterId)
        ? current.filter((id) => id !== chapterId)
        : [...current, chapterId]
    );
  };

  const handleSelectAll = () => {
    setIncludeOutline(outlineAvailable);
    setSelectedChapterIds(chapters.map((chapter) => chapter.id));
  };

  const handleClear = () => {
    setIncludeOutline(false);
    setSelectedChapterIds([]);
  };

  const handleExport = async () => {
    if (selectedCount === 0) return;
    setIsExporting(true);
    try {
      await onExport({
        includeOutline,
        chapterIds: selectedChapterIds
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(6px)' }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="导出小说"
        className="rounded-2xl overflow-hidden flex flex-col"
        style={{
          background: '#FFFFFF',
          boxShadow: '0 32px 80px rgba(0,0,0,0.15)',
          width: '620px',
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: 'calc(100vh - 64px)'
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: '1px solid #EAEAEA' }}
        >
          <div>
            <h2 style={{ color: '#1A1A2E', letterSpacing: '-0.3px' }} className="text-lg">
              导出内容
            </h2>
            <p style={{ color: '#8B8B9E' }} className="text-xs mt-0.5">
              选择要导出的章节和大纲，也可以一键导出全文
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭导出窗口"
            className="p-2 rounded-lg transition-colors"
            style={{ color: '#8B8B9E' }}
            onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = '#F0F0F5'}
            onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}
          >
            <XIcon size={16} />
          </button>
        </div>

        <div className="flex items-center gap-2 px-6 py-3" style={{ borderBottom: '1px solid #F0F0F5' }}>
          <button
            onClick={handleSelectAll}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors"
            style={{
              border: '1px solid #E0E0EA',
              color: allSelected ? '#4A7CF7' : '#6E6E8A',
              background: allSelected ? '#EEF3FF' : '#FFFFFF'
            }}
          >
            <CheckIcon size={11} />
            选择全文
          </button>
          <button
            onClick={handleClear}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors"
            style={{ border: '1px solid #E0E0EA', color: '#6E6E8A', background: '#FFFFFF' }}
          >
            <RotateCcwIcon size={11} />
            清空选择
          </button>
          <div className="text-xs" style={{ color: '#9999B3' }}>
            已选 {selectedCount} 项，约 {(selectedWordCount / 1000).toFixed(1)}k 字
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          <button
            onClick={() => setIncludeOutline((current) => !current)}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-colors"
            style={{
              border: `1.5px solid ${includeOutline ? '#4A7CF7' : '#EAEAEA'}`,
              background: includeOutline ? '#EEF3FF' : '#FFFFFF',
              opacity: outlineAvailable ? 1 : 0.55
            }}
            disabled={!outlineAvailable}
          >
            <div
              className="w-5 h-5 rounded flex items-center justify-center"
              style={{ background: includeOutline ? '#4A7CF7' : '#E0E0EA' }}
            >
              {includeOutline && <CheckIcon size={12} color="#FFFFFF" />}
            </div>
            <div className="flex-1">
              <p style={{ color: '#2A2A3E' }} className="text-sm">
                故事大纲
              </p>
              <p style={{ color: '#9999B3' }} className="text-xs mt-0.5">
                {outlineAvailable ? '导出当前成品区里的大纲内容' : '当前还没有可导出的大纲'}
              </p>
            </div>
            <FileTextIcon size={14} color={includeOutline ? '#4A7CF7' : '#9999B3'} />
          </button>

          <div className="space-y-2">
            {chapters.length ? (
              chapters.map((chapter) => {
                const checked = selectedChapterIds.includes(chapter.id);
                return (
                  <button
                    key={chapter.id}
                    onClick={() => toggleChapter(chapter.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-colors"
                    style={{
                      border: `1.5px solid ${checked ? '#4A7CF7' : '#EAEAEA'}`,
                      background: checked ? '#EEF3FF' : '#FFFFFF'
                    }}
                  >
                    <div
                      className="w-5 h-5 rounded flex items-center justify-center"
                      style={{ background: checked ? '#4A7CF7' : '#E0E0EA' }}
                    >
                      {checked && <CheckIcon size={12} color="#FFFFFF" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p style={{ color: '#2A2A3E' }} className="text-sm truncate">
                        第 {chapter.number} 章 {chapter.title}
                      </p>
                      <p style={{ color: '#9999B3' }} className="text-xs mt-0.5">
                        {(chapter.wordCount / 1000).toFixed(1)}k 字
                      </p>
                    </div>
                  </button>
                );
              })
            ) : (
              <div
                className="rounded-xl px-4 py-6 text-sm text-center"
                style={{ border: '1px dashed #D0D0DC', color: '#9999B3' }}
              >
                当前还没有章节可导出
              </div>
            )}
          </div>
        </div>

        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderTop: '1px solid #EAEAEA' }}
        >
          <div className="text-xs" style={{ color: '#9999B3' }}>
            右上角是唯一导出入口，右侧成品区不再单独导出
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm transition-colors"
              style={{ border: '1.5px solid #E0E0EA', color: '#6E6E8A', background: 'transparent' }}
            >
              取消
            </button>
            <button
              onClick={() => void handleExport()}
              disabled={selectedCount === 0 || isExporting}
              className="flex items-center gap-1.5 px-5 py-2 rounded-lg text-sm transition-colors"
              style={{
                background: selectedCount === 0 || isExporting ? '#D0D0DC' : '#1A1A2E',
                color: '#FFFFFF',
                cursor: selectedCount === 0 || isExporting ? 'not-allowed' : 'pointer'
              }}
            >
              <DownloadIcon size={14} />
              {isExporting ? '导出中...' : '导出所选内容'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
