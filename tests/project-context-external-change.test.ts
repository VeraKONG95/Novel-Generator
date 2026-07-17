import { describe, expect, it, vi } from 'vitest';
import { refreshExternalWorkspace } from '../src/app/context/ProjectContext';

describe('external chapter changes', () => {
  it('starts WF02 after a changed chapter has been reloaded successfully', async () => {
    const project = { id: 'project-1' };
    const reloadWorkspace = vi.fn().mockResolvedValue({ ok: true, data: project, revisions: {} });
    const startAnalysis = vi.fn().mockResolvedValue({ ok: true });

    const result = await refreshExternalWorkspace({
      root: '/novel',
      paths: ['chapters\\0001.md'],
      hasUnsavedChanges: false,
      reloadWorkspace,
      startAnalysis
    });

    expect(reloadWorkspace).toHaveBeenCalledWith('/novel');
    expect(startAnalysis).toHaveBeenCalledWith({
      root: '/novel',
      workflowId: 'WF02',
      input: { changedPaths: ['chapters/0001.md'] }
    });
    expect(reloadWorkspace.mock.invocationCallOrder[0]).toBeLessThan(
      startAnalysis.mock.invocationCallOrder[0]
    );
    expect(result.reloadResult.data).toBe(project);
  });

  it('does not reload or analyze while the project has unsaved changes', async () => {
    const reloadWorkspace = vi.fn();
    const startAnalysis = vi.fn();

    const result = await refreshExternalWorkspace({
      root: '/novel',
      paths: ['chapters/0002.md'],
      hasUnsavedChanges: true,
      reloadWorkspace,
      startAnalysis
    });

    expect(reloadWorkspace).not.toHaveBeenCalled();
    expect(startAnalysis).not.toHaveBeenCalled();
    expect(result.skipped).toBe('unsaved');
  });

  it('reloads non-chapter changes without starting WF02', async () => {
    const reloadWorkspace = vi.fn().mockResolvedValue({
      ok: true,
      data: { id: 'project-1' },
      revisions: {}
    });
    const startAnalysis = vi.fn();

    await refreshExternalWorkspace({
      root: '/novel',
      paths: ['outline/book.md', 'knowledge\\CURRENT.json'],
      hasUnsavedChanges: false,
      reloadWorkspace,
      startAnalysis
    });

    expect(reloadWorkspace).toHaveBeenCalledOnce();
    expect(startAnalysis).not.toHaveBeenCalled();
  });

  it('does not start WF02 when the workspace refresh fails', async () => {
    const reloadWorkspace = vi.fn().mockResolvedValue({ ok: false, error: 'refresh failed' });
    const startAnalysis = vi.fn();

    await refreshExternalWorkspace({
      root: '/novel',
      paths: ['chapters/0003.md'],
      hasUnsavedChanges: false,
      reloadWorkspace,
      startAnalysis
    });

    expect(startAnalysis).not.toHaveBeenCalled();
  });
});
