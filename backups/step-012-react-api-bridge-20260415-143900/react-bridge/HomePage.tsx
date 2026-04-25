import { useState } from 'react';
import { useNavigate } from 'react-router';
import { PlusIcon, BookOpenIcon, ClockIcon, MoreHorizontalIcon, Trash2Icon, PencilIcon, CheckIcon, XIcon } from 'lucide-react';
import { MOCK_PROJECTS } from '../data/mockData';
import { Project } from '../types';

export function HomePage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>(MOCK_PROJECTS);
  const [showNewModal, setShowNewModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newGenre, setNewGenre] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const handleCreate = () => {
    if (!newTitle.trim()) return;
    const newProject: Project = {
      id: `proj-${Date.now()}`,
      title: newTitle.trim(),
      genre: newGenre.trim() || '未分类',
      description: newDesc.trim() || '暂无简介',
      createdAt: new Date().toISOString().split('T')[0],
      updatedAt: new Date().toISOString().split('T')[0],
      chaptersCompleted: 0,
      totalChapters: 0,
      wordCount: 0,
    };
    setProjects([newProject, ...projects]);
    setNewTitle('');
    setNewGenre('');
    setNewDesc('');
    setShowNewModal(false);
    navigate(`/project/${newProject.id}`);
  };

  const handleDelete = (id: string) => {
    setProjects(projects.filter((p) => p.id !== id));
    setMenuOpenId(null);
  };

  const handleStartRename = (p: Project) => {
    setRenamingId(p.id);
    setRenameValue(p.title);
    setMenuOpenId(null);
  };

  const handleRename = (id: string) => {
    if (!renameValue.trim()) return;
    setProjects(projects.map((p) => p.id === id ? { ...p, title: renameValue.trim() } : p));
    setRenamingId(null);
  };

  const getProgressPercent = (p: Project) => {
    if (p.totalChapters === 0) return 0;
    return Math.round((p.chaptersCompleted / p.totalChapters) * 100);
  };

  return (
    <div className="min-h-screen" style={{ background: '#F7F7F8', fontFamily: "'Noto Sans SC', -apple-system, BlinkMacSystemFont, sans-serif" }}>
      {/* Top bar */}
      <header style={{ background: '#FFFFFF', borderBottom: '1px solid #EAEAEA' }} className="sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div style={{ background: '#1A1A2E', borderRadius: '8px' }} className="w-7 h-7 flex items-center justify-center">
              <BookOpenIcon size={14} color="#FFFFFF" />
            </div>
            <span style={{ color: '#1A1A2E', letterSpacing: '-0.3px' }} className="text-base">墨境创作台</span>
          </div>
          <button
            onClick={() => setShowNewModal(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg transition-all"
            style={{ background: '#1A1A2E', color: '#FFFFFF' }}
          >
            <PlusIcon size={15} />
            <span className="text-sm">新建项目</span>
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-5xl mx-auto px-6 py-10">
        {/* Section header */}
        <div className="mb-7 flex items-center justify-between">
          <div>
            <h1 style={{ color: '#1A1A2E', letterSpacing: '-0.5px' }} className="text-2xl">我的创作</h1>
            <p style={{ color: '#8B8B9E' }} className="text-sm mt-0.5">{projects.length} 个项目</p>
          </div>
        </div>

        {/* Project grid */}
        {projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div style={{ background: '#EAEAF0', borderRadius: '20px' }} className="w-16 h-16 flex items-center justify-center">
              <BookOpenIcon size={28} color="#9999B3" />
            </div>
            <div className="text-center">
              <p style={{ color: '#4A4A6A' }} className="text-base">还没有创作项目</p>
              <p style={{ color: '#8B8B9E' }} className="text-sm mt-1">点击"新建项目"开始您的第一部作品</p>
            </div>
            <button
              onClick={() => setShowNewModal(true)}
              className="mt-2 flex items-center gap-1.5 px-5 py-2.5 rounded-lg transition-all"
              style={{ background: '#1A1A2E', color: '#FFFFFF' }}
            >
              <PlusIcon size={15} />
              <span className="text-sm">新建项目</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project) => {
              const pct = getProgressPercent(project);
              const isRenaming = renamingId === project.id;
              const menuOpen = menuOpenId === project.id;
              return (
                <div
                  key={project.id}
                  className="group relative rounded-xl p-5 cursor-pointer transition-all"
                  style={{
                    background: '#FFFFFF',
                    border: '1px solid #EAEAEA',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                  }}
                  onClick={() => !isRenaming && !menuOpen && navigate(`/project/${project.id}`)}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)';
                    (e.currentTarget as HTMLElement).style.borderColor = '#D8D8E8';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)';
                    (e.currentTarget as HTMLElement).style.borderColor = '#EAEAEA';
                  }}
                >
                  {/* Card header */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0 mr-2">
                      {isRenaming ? (
                        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                          <input
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleRename(project.id);
                              if (e.key === 'Escape') setRenamingId(null);
                            }}
                            className="flex-1 px-2 py-1 rounded text-sm outline-none"
                            style={{ border: '1.5px solid #4A7CF7', background: '#F0F4FF', color: '#1A1A2E' }}
                            autoFocus
                          />
                          <button onClick={() => handleRename(project.id)} className="p-1 rounded hover:bg-green-50">
                            <CheckIcon size={14} color="#22C55E" />
                          </button>
                          <button onClick={() => setRenamingId(null)} className="p-1 rounded hover:bg-red-50">
                            <XIcon size={14} color="#EF4444" />
                          </button>
                        </div>
                      ) : (
                        <h3 style={{ color: '#1A1A2E', lineHeight: '1.4' }} className="text-base truncate">{project.title}</h3>
                      )}
                      <span
                        className="inline-block mt-1 px-2 py-0.5 rounded text-xs"
                        style={{ background: '#F0F0F5', color: '#6E6E8A' }}
                      >
                        {project.genre}
                      </span>
                    </div>
                    {/* More menu */}
                    <div className="relative" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ color: '#8B8B9E' }}
                        onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = '#F0F0F5'}
                        onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuOpenId(menuOpen ? null : project.id);
                        }}
                      >
                        <MoreHorizontalIcon size={16} />
                      </button>
                      {menuOpen && (
                        <div
                          className="absolute right-0 top-8 z-20 rounded-lg overflow-hidden"
                          style={{ background: '#FFFFFF', border: '1px solid #EAEAEA', boxShadow: '0 8px 24px rgba(0,0,0,0.1)', width: '140px' }}
                        >
                          <button
                            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm transition-colors"
                            style={{ color: '#4A4A6A' }}
                            onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = '#F7F7F8'}
                            onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                            onClick={() => handleStartRename(project)}
                          >
                            <PencilIcon size={13} />
                            重命名
                          </button>
                          <button
                            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm transition-colors"
                            style={{ color: '#E53E3E' }}
                            onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = '#FFF5F5'}
                            onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                            onClick={() => handleDelete(project.id)}
                          >
                            <Trash2Icon size={13} />
                            删除项目
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Description */}
                  <p style={{ color: '#6E6E8A', lineHeight: '1.6', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }} className="text-xs mb-4">
                    {project.description}
                  </p>

                  {/* Stats */}
                  <div className="flex items-center gap-4 mb-3.5">
                    <div className="flex items-center gap-1.5">
                      <BookOpenIcon size={12} color="#9999B3" />
                      <span style={{ color: '#9999B3' }} className="text-xs">
                        {project.chaptersCompleted}/{project.totalChapters || '—'} 章
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <ClockIcon size={12} color="#9999B3" />
                      <span style={{ color: '#9999B3' }} className="text-xs">{project.updatedAt}</span>
                    </div>
                    {project.wordCount > 0 && (
                      <span style={{ color: '#9999B3' }} className="text-xs">{(project.wordCount / 10000).toFixed(1)}万字</span>
                    )}
                  </div>

                  {/* Progress bar */}
                  <div className="rounded-full overflow-hidden" style={{ height: '3px', background: '#F0F0F5' }}>
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${pct}%`,
                        background: pct === 100 ? '#22C55E' : '#4A7CF7',
                      }}
                    />
                  </div>
                  {pct > 0 && (
                    <p style={{ color: '#9999B3' }} className="text-xs mt-1.5">
                      {pct === 100 ? '✓ 已完成' : `${pct}% 进行中`}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Click outside to close menu */}
      {menuOpenId && (
        <div className="fixed inset-0 z-10" onClick={() => setMenuOpenId(null)} />
      )}

      {/* New project modal */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(4px)' }}>
          <div
            className="rounded-2xl p-7 w-full max-w-md mx-4"
            style={{ background: '#FFFFFF', boxShadow: '0 24px 64px rgba(0,0,0,0.12)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ color: '#1A1A2E', letterSpacing: '-0.3px' }} className="text-xl mb-1.5">新建创作项目</h2>
            <p style={{ color: '#8B8B9E' }} className="text-sm mb-6">填写基础信息，开始您的创作旅程</p>

            <div className="space-y-4">
              <div>
                <label style={{ color: '#4A4A6A', display: 'block', marginBottom: '6px' }} className="text-sm">作品名称 *</label>
                <input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="为您的故事取一个名字"
                  className="w-full px-3 py-2.5 rounded-lg outline-none transition-all text-sm"
                  style={{ border: '1.5px solid #E0E0EA', background: '#FAFAFA', color: '#1A1A2E' }}
                  onFocus={(e) => (e.target.style.borderColor = '#4A7CF7')}
                  onBlur={(e) => (e.target.style.borderColor = '#E0E0EA')}
                  autoFocus
                />
              </div>
              <div>
                <label style={{ color: '#4A4A6A', display: 'block', marginBottom: '6px' }} className="text-sm">类型 / 风格</label>
                <input
                  value={newGenre}
                  onChange={(e) => setNewGenre(e.target.value)}
                  placeholder="如：都市奇幻、武侠、科幻..."
                  className="w-full px-3 py-2.5 rounded-lg outline-none transition-all text-sm"
                  style={{ border: '1.5px solid #E0E0EA', background: '#FAFAFA', color: '#1A1A2E' }}
                  onFocus={(e) => (e.target.style.borderColor = '#4A7CF7')}
                  onBlur={(e) => (e.target.style.borderColor = '#E0E0EA')}
                />
              </div>
              <div>
                <label style={{ color: '#4A4A6A', display: 'block', marginBottom: '6px' }} className="text-sm">故事简介</label>
                <textarea
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="用几句话描述您的故事..."
                  rows={3}
                  className="w-full px-3 py-2.5 rounded-lg outline-none transition-all text-sm resize-none"
                  style={{ border: '1.5px solid #E0E0EA', background: '#FAFAFA', color: '#1A1A2E' }}
                  onFocus={(e) => (e.target.style.borderColor = '#4A7CF7')}
                  onBlur={(e) => (e.target.style.borderColor = '#E0E0EA')}
                />
              </div>
            </div>

            <div className="flex gap-3 mt-7">
              <button
                onClick={() => setShowNewModal(false)}
                className="flex-1 py-2.5 rounded-lg text-sm transition-colors"
                style={{ border: '1.5px solid #E0E0EA', color: '#6E6E8A', background: 'transparent' }}
                onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = '#F7F7F8'}
                onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}
              >
                取消
              </button>
              <button
                onClick={handleCreate}
                disabled={!newTitle.trim()}
                className="flex-1 py-2.5 rounded-lg text-sm transition-all"
                style={{
                  background: newTitle.trim() ? '#1A1A2E' : '#D0D0DC',
                  color: '#FFFFFF',
                  cursor: newTitle.trim() ? 'pointer' : 'not-allowed',
                }}
              >
                创建项目
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
