import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  PlusIcon,
  BookOpenIcon,
  ClockIcon,
  MoreHorizontalIcon,
  Trash2Icon,
  PencilIcon,
  CheckIcon,
  XIcon,
  FolderOpenIcon,
  Settings2Icon
} from 'lucide-react';
import { SettingsModal } from '../components/modals/SettingsModal';
import { useProjectContext } from '../context/ProjectContext';
import { buildHomeProjects } from '../lib/projectBridge';
import { Project } from '../types';

export function HomePage() {
  const navigate = useNavigate();
  const {
    currentProject,
    currentPath,
    recentProjects,
    draftProjects,
    settings,
    createProject,
    discardCurrentProject,
    updateCurrentProject,
    openProject,
    openProjectFromPath,
    openDraftProject,
    saveSettings,
    removeProjectEntry,
    removeDraftEntry,
    renameProjectEntry,
    renameDraftEntry,
    isReady
  } = useProjectContext();

  const projects = buildHomeProjects(currentProject, currentPath, recentProjects, draftProjects);
  const [showNewModal, setShowNewModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newGenre, setNewGenre] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [notification, setNotification] = useState<{
    msg: string;
    type: 'success' | 'info' | 'error';
  } | null>(null);

  const showNotification = (msg: string, type: 'success' | 'info' | 'error' = 'success') => {
    setNotification({ msg, type });
    window.setTimeout(() => setNotification(null), 2600);
  };

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    const project = await createProject({
      title: newTitle.trim(),
      genre: newGenre.trim(),
      description: newDesc.trim()
    });
    setNewTitle('');
    setNewGenre('');
    setNewDesc('');
    setShowNewModal(false);
    navigate(`/project/${project.id}`);
  };

  const handleOpenDialog = async () => {
    setBusyId('dialog');
    const result = await openProject();
    setBusyId(null);
    if (result.ok && result.data) {
      navigate(`/project/${result.data.id}`);
      showNotification('项目已打开');
      return;
    }
    if (result.error) {
      showNotification(`导入项目失败：${result.error}`, 'error');
    }
  };

  const handleOpenProjectCard = async (project: Project) => {
    if (project.source === 'draft' && project.draftId) {
      setBusyId(project.id);
      const result = await openDraftProject(project.draftId);
      setBusyId(null);
      if (result.ok && result.data) {
        navigate(`/project/${result.data.id}`);
        showNotification('草稿已恢复');
        return;
      }
      showNotification(`加载草稿失败：${result.error || '未知错误'}`, 'error');
      return;
    }

    if (!project.filePath) {
      navigate(`/project/${project.id}`);
      return;
    }

    if (currentPath && project.filePath === currentPath && currentProject) {
      navigate(`/project/${currentProject.id}`);
      return;
    }

    setBusyId(project.id);
    const result = await openProjectFromPath(project.filePath);
    setBusyId(null);
    if (result.ok && result.data) {
      navigate(`/project/${result.data.id}`);
      showNotification('项目已加载');
      return;
    }
    showNotification(`加载失败：${result.error || '未知错误'}`, 'error');
  };

  const handleDelete = (project: Project) => {
    if (project.filePath) {
      removeProjectEntry(project.filePath);
      showNotification('已从最近项目中移除', 'info');
    } else if (project.source === 'draft' && project.draftId) {
      void removeDraftEntry(project.draftId);
      if (currentProject?.id === project.id && !currentPath) {
        discardCurrentProject();
      }
      showNotification('草稿已移除', 'info');
    } else if (currentProject?.id === project.id) {
      discardCurrentProject();
      showNotification('未保存草稿已移除', 'info');
    }
    setMenuOpenId(null);
  };

  const handleStartRename = (project: Project) => {
    setRenamingId(project.id);
    setRenameValue(project.title);
    setMenuOpenId(null);
  };

  const handleRename = (project: Project) => {
    if (!renameValue.trim()) return;

    if (currentProject?.id === project.id) {
      updateCurrentProject((current) => ({
        ...current,
        title: renameValue.trim(),
        updatedAt: new Date().toISOString()
      }));
      if (currentPath) {
        renameProjectEntry(currentPath, renameValue.trim());
      } else {
        void renameDraftEntry(project.id, renameValue.trim());
      }
    } else if (project.filePath) {
      renameProjectEntry(project.filePath, renameValue.trim());
    } else if (project.source === 'draft' && project.draftId) {
      void renameDraftEntry(project.draftId, renameValue.trim());
    }

    setRenamingId(null);
    showNotification('项目标题已更新');
  };

  const getProgressPercent = (project: Project) => {
    if (project.totalChapters === 0) return 0;
    return Math.round((project.chaptersCompleted / project.totalChapters) * 100);
  };

  return (
    <div
      className="min-h-screen"
      style={{
        background: '#F7F7F8',
        fontFamily: "'Noto Sans SC', -apple-system, BlinkMacSystemFont, sans-serif"
      }}
    >
      <header
        style={{ background: '#FFFFFF', borderBottom: '1px solid #EAEAEA' }}
        className="sticky top-0 z-10"
      >
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div
              style={{ background: '#1A1A2E', borderRadius: '8px' }}
              className="w-7 h-7 flex items-center justify-center"
            >
              <BookOpenIcon size={14} color="#FFFFFF" />
            </div>
            <span style={{ color: '#1A1A2E', letterSpacing: '-0.3px' }} className="text-base">
              墨境创作台
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettingsModal(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg transition-all"
              style={{ border: '1px solid #E0E0EA', color: settings.apiKey ? '#6E6E8A' : '#C67A1B', background: '#FFFFFF' }}
            >
              <Settings2Icon size={15} />
              <span className="text-sm">{settings.apiKey ? '模型设置' : '配置 API'}</span>
            </button>
            <button
              onClick={() => void handleOpenDialog()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg transition-all"
              style={{ border: '1px solid #E0E0EA', color: '#6E6E8A', background: '#FFFFFF' }}
            >
              <FolderOpenIcon size={15} />
              <span className="text-sm">{busyId === 'dialog' ? '导入中...' : '导入项目'}</span>
            </button>
            <button
              onClick={() => setShowNewModal(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg transition-all"
              style={{ background: '#1A1A2E', color: '#FFFFFF' }}
            >
              <PlusIcon size={15} />
              <span className="text-sm">新建项目</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10">
        <div className="mb-7 flex items-center justify-between">
          <div>
            <h1 style={{ color: '#1A1A2E', letterSpacing: '-0.5px' }} className="text-2xl">
              我的创作
            </h1>
            <p style={{ color: '#8B8B9E' }} className="text-sm mt-0.5">
              {isReady ? `${projects.length} 个项目` : '正在恢复项目...'}
            </p>
          </div>
        </div>

        {!isReady ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div
              style={{ background: '#EAEAF0', borderRadius: '20px' }}
              className="w-16 h-16 flex items-center justify-center"
            >
              <BookOpenIcon size={28} color="#9999B3" />
            </div>
            <p style={{ color: '#4A4A6A' }} className="text-base">
              正在准备工作区...
            </p>
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div
              style={{ background: '#EAEAF0', borderRadius: '20px' }}
              className="w-16 h-16 flex items-center justify-center"
            >
              <BookOpenIcon size={28} color="#9999B3" />
            </div>
            <div className="text-center">
              <p style={{ color: '#4A4A6A' }} className="text-base">
                还没有创作项目
              </p>
              <p style={{ color: '#8B8B9E' }} className="text-sm mt-1">
                新建项目或打开已有项目，继续您的创作流程
              </p>
            </div>
            <div className="flex items-center gap-3 mt-2">
              <button
                onClick={() => void handleOpenDialog()}
                className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg transition-all"
                style={{ border: '1px solid #E0E0EA', color: '#6E6E8A', background: '#FFFFFF' }}
              >
                <FolderOpenIcon size={15} />
                <span className="text-sm">导入项目</span>
              </button>
              <button
                onClick={() => setShowNewModal(true)}
                className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg transition-all"
                style={{ background: '#1A1A2E', color: '#FFFFFF' }}
              >
                <PlusIcon size={15} />
                <span className="text-sm">新建项目</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project) => {
              const pct = getProgressPercent(project);
              const isRenaming = renamingId === project.id;
              const menuOpen = menuOpenId === project.id;
              const isBusy = busyId === project.id;

              return (
                <div
                  key={`${project.filePath || 'draft'}-${project.id}`}
                  className="group relative rounded-xl p-5 cursor-pointer transition-all"
                  style={{
                    background: '#FFFFFF',
                    border: '1px solid #EAEAEA',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
                  }}
                  onClick={() =>
                    !isRenaming && !menuOpen && !isBusy && void handleOpenProjectCard(project)
                  }
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.boxShadow =
                      '0 4px 12px rgba(0,0,0,0.08)';
                    (e.currentTarget as HTMLElement).style.borderColor = '#D8D8E8';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.boxShadow =
                      '0 1px 3px rgba(0,0,0,0.04)';
                    (e.currentTarget as HTMLElement).style.borderColor = '#EAEAEA';
                  }}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0 mr-2">
                      {isRenaming ? (
                        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                          <input
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleRename(project);
                              if (e.key === 'Escape') setRenamingId(null);
                            }}
                            className="flex-1 px-2 py-1 rounded text-sm outline-none"
                            style={{
                              border: '1.5px solid #4A7CF7',
                              background: '#F0F4FF',
                              color: '#1A1A2E'
                            }}
                            autoFocus
                          />
                          <button
                            onClick={() => handleRename(project)}
                            className="p-1 rounded hover:bg-green-50"
                          >
                            <CheckIcon size={14} color="#22C55E" />
                          </button>
                          <button
                            onClick={() => setRenamingId(null)}
                            className="p-1 rounded hover:bg-red-50"
                          >
                            <XIcon size={14} color="#EF4444" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <h3
                            style={{ color: '#1A1A2E', lineHeight: '1.4' }}
                            className="text-base truncate"
                          >
                            {project.title}
                          </h3>
                          <div className="flex items-center gap-2 mt-1">
                            <span
                              className="inline-block px-2 py-0.5 rounded text-xs"
                              style={{ background: '#F0F0F5', color: '#6E6E8A' }}
                            >
                              {project.genre}
                            </span>
                            {!project.filePath && (
                              <span
                                className="inline-block px-2 py-0.5 rounded text-xs"
                                style={{
                                  background: project.source === 'draft' ? '#EEF3FF' : '#FFF5E8',
                                  color: project.source === 'draft' ? '#4A7CF7' : '#C67A1B'
                                }}
                              >
                                {project.source === 'draft' ? '草稿箱' : '未保存'}
                              </span>
                            )}
                          </div>
                        </>
                      )}
                    </div>
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
                          style={{
                            background: '#FFFFFF',
                            border: '1px solid #EAEAEA',
                            boxShadow: '0 8px 24px rgba(0,0,0,0.1)',
                            width: '140px'
                          }}
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
                            onClick={() => handleDelete(project)}
                          >
                            <Trash2Icon size={13} />
                            {project.filePath ? '移出列表' : '丢弃草稿'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <p
                    style={{
                      color: '#6E6E8A',
                      lineHeight: '1.6',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden'
                    }}
                    className="text-xs mb-4"
                  >
                    {project.description}
                  </p>

                  <div className="flex items-center gap-4 mb-3.5">
                    <div className="flex items-center gap-1.5">
                      <BookOpenIcon size={12} color="#9999B3" />
                      <span style={{ color: '#9999B3' }} className="text-xs">
                        {project.chaptersCompleted}/{project.totalChapters || '—'} 章
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <ClockIcon size={12} color="#9999B3" />
                      <span style={{ color: '#9999B3' }} className="text-xs">
                        {project.updatedAt || '刚刚'}
                      </span>
                    </div>
                    {project.wordCount > 0 && (
                      <span style={{ color: '#9999B3' }} className="text-xs">
                        {(project.wordCount / 10000).toFixed(1)}万字
                      </span>
                    )}
                  </div>

                  <div
                    className="rounded-full overflow-hidden"
                    style={{ height: '3px', background: '#F0F0F5' }}
                  >
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${pct}%`,
                        background: pct === 100 ? '#22C55E' : '#4A7CF7'
                      }}
                    />
                  </div>
                  <p style={{ color: '#9999B3' }} className="text-xs mt-1.5">
                    {isBusy ? '正在加载...' : pct === 100 ? '✓ 已完成' : pct > 0 ? `${pct}% 进行中` : '点击进入项目'}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {menuOpenId && <div className="fixed inset-0 z-10" onClick={() => setMenuOpenId(null)} />}

      {showNewModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(4px)' }}
        >
          <div
            className="rounded-2xl p-7 w-full max-w-md mx-4"
            style={{ background: '#FFFFFF', boxShadow: '0 24px 64px rgba(0,0,0,0.12)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              style={{ color: '#1A1A2E', letterSpacing: '-0.3px' }}
              className="text-xl mb-1.5"
            >
              新建创作项目
            </h2>
            <p style={{ color: '#8B8B9E' }} className="text-sm mb-6">
              填写基础信息，马上进入写作界面
            </p>

            <div className="space-y-4">
              <div>
                <label
                  style={{ color: '#4A4A6A', display: 'block', marginBottom: '6px' }}
                  className="text-sm"
                >
                  作品名称 *
                </label>
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
                <label
                  style={{ color: '#4A4A6A', display: 'block', marginBottom: '6px' }}
                  className="text-sm"
                >
                  类型 / 风格
                </label>
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
                <label
                  style={{ color: '#4A4A6A', display: 'block', marginBottom: '6px' }}
                  className="text-sm"
                >
                  故事简介
                </label>
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
                onClick={() => void handleCreate()}
                disabled={!newTitle.trim()}
                className="flex-1 py-2.5 rounded-lg text-sm transition-all"
                style={{
                  background: newTitle.trim() ? '#1A1A2E' : '#D0D0DC',
                  color: '#FFFFFF',
                  cursor: newTitle.trim() ? 'pointer' : 'not-allowed'
                }}
              >
                创建项目
              </button>
            </div>
          </div>
        </div>
      )}

      {notification && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 rounded-xl text-sm z-50"
          style={{
            background:
              notification.type === 'success'
                ? '#1A1A2E'
                : notification.type === 'error'
                  ? '#B42318'
                  : '#4A7CF7',
            color: '#FFFFFF',
            boxShadow: '0 8px 24px rgba(0,0,0,0.15)'
          }}
        >
          {notification.msg}
        </div>
      )}

      {showSettingsModal && (
        <SettingsModal
          settings={settings}
          onSave={async (nextSettings) => {
            await saveSettings(nextSettings);
            showNotification('模型设置已保存');
          }}
          onClose={() => setShowSettingsModal(false)}
        />
      )}
    </div>
  );
}
