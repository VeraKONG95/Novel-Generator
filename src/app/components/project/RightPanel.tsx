import { useMemo, useState } from 'react';
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FileJsonIcon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon
} from 'lucide-react';
import { WorkspaceFile } from '../../types';

interface FileNode {
  name: string;
  path: string;
  children: FileNode[];
  file?: WorkspaceFile;
}

interface RightPanelProps {
  files: WorkspaceFile[];
  collapsed: boolean;
  selectedPath?: string;
  onToggle: () => void;
  onOpenFile: (file: WorkspaceFile) => void;
}

function buildTree(files: WorkspaceFile[]) {
  const root: FileNode = { name: '', path: '', children: [] };
  files.forEach((file) => {
    const parts = file.path.split('/');
    let parent = root;
    parts.forEach((part, index) => {
      const nextPath = parts.slice(0, index + 1).join('/');
      let node = parent.children.find((item) => item.name === part);
      if (!node) {
        node = { name: part, path: nextPath, children: [] };
        parent.children.push(node);
      }
      if (index === parts.length - 1) node.file = file;
      parent = node;
    });
  });
  const sort = (node: FileNode) => {
    node.children.sort((a, b) => Number(Boolean(a.file)) - Number(Boolean(b.file)) || a.name.localeCompare(b.name, 'zh-CN'));
    node.children.forEach(sort);
  };
  sort(root);
  return root.children;
}

function FileIcon({ name }: { name: string }) {
  return name.endsWith('.json') || name.endsWith('.jsonl')
    ? <FileJsonIcon size={14} color="#8B8B9E" />
    : <FileTextIcon size={14} color="#8B8B9E" />;
}

export function RightPanel({ files, collapsed, selectedPath, onToggle, onOpenFile }: RightPanelProps) {
  const tree = useMemo(() => buildTree(files), [files]);
  const [closedFolders, setClosedFolders] = useState<Set<string>>(new Set());

  const toggleFolder = (folderPath: string) => {
    setClosedFolders((current) => {
      const next = new Set(current);
      if (next.has(folderPath)) next.delete(folderPath);
      else next.add(folderPath);
      return next;
    });
  };

  const renderNode = (node: FileNode, depth = 0): React.ReactNode => {
    if (node.file) {
      const selected = selectedPath === node.path;
      return (
        <button
          key={node.path}
          onClick={() => onOpenFile(node.file!)}
          className="w-full flex items-center gap-2 rounded-lg py-2 pr-2 text-left transition-colors"
          style={{
            paddingLeft: `${10 + depth * 16}px`,
            background: selected ? '#EEF3FF' : 'transparent',
            color: selected ? '#2E5BD1' : '#4A4A6A'
          }}
          title={node.path}
        >
          <FileIcon name={node.name} />
          <span className="text-xs truncate flex-1">{node.name}</span>
        </button>
      );
    }
    const closed = closedFolders.has(node.path);
    return (
      <div key={node.path}>
        <button
          onClick={() => toggleFolder(node.path)}
          className="w-full flex items-center gap-1.5 rounded-lg py-2 pr-2 text-left transition-colors"
          style={{ paddingLeft: `${8 + depth * 16}px`, color: '#3A3A5A' }}
        >
          {closed ? <ChevronRightIcon size={12} color="#9999B3" /> : <ChevronDownIcon size={12} color="#9999B3" />}
          {closed ? <FolderIcon size={14} color="#7D8BA8" /> : <FolderOpenIcon size={14} color="#7D8BA8" />}
          <span className="text-xs truncate">{node.name}</span>
        </button>
        {!closed && node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  if (collapsed) {
    return (
      <div className="h-full flex flex-col items-center py-3" style={{ borderLeft: '1px solid #EAEAEA', background: '#FAFAFA' }}>
        <button
          onClick={onToggle}
          aria-label="展开项目文件"
          title="展开项目文件"
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ color: '#6E6E8A' }}
        >
          <FolderIcon size={16} />
        </button>
        <div className="mt-2" style={{ color: '#9999B3', writingMode: 'vertical-rl', fontSize: '11px', letterSpacing: '0.12em' }}>
          项目文件
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" style={{ borderLeft: '1px solid #EAEAEA', background: '#FAFAFA' }}>
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-3.5" style={{ borderBottom: '1px solid #EAEAEA' }}>
        <div>
          <p className="text-sm" style={{ color: '#1A1A2E' }}>项目文件</p>
          <p className="text-xs mt-0.5" style={{ color: '#9999B3' }}>{files.length} 个文件</p>
        </div>
        <button
          onClick={onToggle}
          aria-label="收起项目文件"
          title="收起项目文件"
          className="p-1.5 rounded-lg"
          style={{ color: '#8B8B9E' }}
        >
          <ChevronRightIcon size={15} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {tree.length ? tree.map((node) => renderNode(node)) : (
          <div className="px-3 py-10 text-center">
            <FolderIcon size={22} color="#C8C8D8" className="mx-auto" />
            <p className="text-xs mt-2" style={{ color: '#9999B3' }}>暂无项目文件</p>
          </div>
        )}
      </div>
      <div className="px-3 py-3 flex items-center gap-2" style={{ borderTop: '1px solid #EAEAEA', color: '#9999B3' }}>
        <ChevronLeftIcon size={12} />
        <span className="text-xs">点击文件可只读预览</span>
      </div>
    </div>
  );
}
