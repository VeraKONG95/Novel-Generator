import { useMemo, useState } from 'react';
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronUpIcon,
  CirclePauseIcon,
  CirclePlayIcon,
  Clock3Icon,
  GaugeIcon,
  LoaderCircleIcon,
  RotateCcwIcon,
  SquareIcon,
  WorkflowIcon
} from 'lucide-react';
import {
  AnalysisRunSummary,
  AnalysisStatus,
  analysisStatusCopy,
  shouldLockCreation
} from '../../lib/analysis';

type AnalysisAction = () => void | Promise<void>;

export interface AnalysisStatusRun extends AnalysisRunSummary {
  status: AnalysisStatus | string;
  totalTasks?: number;
  completedTasks?: number;
  runningTasks?: number;
  failedTasks?: number;
  waitingTasks?: number;
  totalJobs?: number;
  completedJobs?: number;
  runningJobs?: number;
  failedJobs?: number;
  waitingJobs?: number;
  actualConcurrency?: number;
  maxConcurrency?: number;
  currentItems?: string[];
  currentTargets?: string[];
  pauseRequested?: boolean;
  error?: string;
}

interface AnalysisStatusBarProps {
  run: AnalysisStatusRun | null;
  className?: string;
  defaultExpanded?: boolean;
  onStart?: AnalysisAction;
  onPause?: AnalysisAction;
  onResume?: AnalysisAction;
  onCancel?: AnalysisAction;
  onRetry?: AnalysisAction;
  onSetConcurrency?: (value: number) => void | Promise<void>;
}

const STATUS_COLORS: Record<string, { ink: string; wash: string; border: string }> = {
  uninitialized: { ink: '#5C6270', wash: '#F3F1EA', border: '#D8D3C5' },
  raw_imported: { ink: '#315C9B', wash: '#EEF3FA', border: '#BFCDE3' },
  analyzing: { ink: '#24599C', wash: '#EAF1FA', border: '#AFC2DE' },
  paused: { ink: '#62677A', wash: '#F0F0F2', border: '#CACAD2' },
  ready: { ink: '#326D54', wash: '#ECF5F0', border: '#B5D3C3' },
  degraded: { ink: '#8A641E', wash: '#FBF4E5', border: '#E1C98F' },
  failed: { ink: '#9D4138', wash: '#FAEEEC', border: '#E3B5AF' },
  cancelled: { ink: '#6B6670', wash: '#F2F0F1', border: '#D2CDD0' }
};

function countValue(...values: Array<number | undefined>) {
  return values.find((value) => Number.isFinite(value)) ?? 0;
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'ready') return <CheckCircle2Icon size={16} />;
  if (status === 'failed' || status === 'degraded') return <AlertTriangleIcon size={16} />;
  if (status === 'paused') return <CirclePauseIcon size={16} />;
  if (status === 'analyzing') return <LoaderCircleIcon size={16} className="animate-spin" />;
  return <Clock3Icon size={16} />;
}

function ActionButton({
  label,
  icon,
  onClick,
  disabled,
  emphasis = false,
  danger = false
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
  emphasis?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-xs transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A7CF7]/35 disabled:cursor-not-allowed disabled:opacity-45"
      style={{
        background: emphasis ? '#1D2533' : danger ? '#FFF8F6' : '#FFFEFA',
        border: emphasis ? '1px solid #1D2533' : `1px solid ${danger ? '#D9A29B' : '#CEC8B8'}`,
        color: emphasis ? '#FFFFFF' : danger ? '#9D4138' : '#3E4654',
        boxShadow: emphasis ? '0 3px 8px rgba(29, 37, 51, 0.16)' : '0 1px 2px rgba(32, 38, 48, 0.04)'
      }}
    >
      {icon}
      {label}
    </button>
  );
}

export function AnalysisStatusBar({
  run,
  className = '',
  defaultExpanded = false,
  onStart,
  onPause,
  onResume,
  onCancel,
  onRetry,
  onSetConcurrency
}: AnalysisStatusBarProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [pendingAction, setPendingAction] = useState('');

  const status = String(run?.status || 'uninitialized');
  const copy = analysisStatusCopy(status);
  const colors = STATUS_COLORS[status] || STATUS_COLORS.uninitialized;
  const total = countValue(run?.totalTasks, run?.totalJobs);
  const completed = countValue(run?.completedTasks, run?.completedJobs);
  const running = countValue(run?.runningTasks, run?.runningJobs);
  const failed = countValue(run?.failedTasks, run?.failedJobs);
  const waiting = countValue(run?.waitingTasks, run?.waitingJobs);
  const actualConcurrency = Math.max(0, Number(run?.actualConcurrency) || 0);
  const maxConcurrency = Math.max(1, Math.min(8, Number(run?.maxConcurrency) || 4));
  const progress = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : status === 'ready' ? 100 : 0;
  const blockingGaps = Array.isArray(run?.blockingGaps) ? run.blockingGaps : [];
  const nonBlockingGaps = Array.isArray(run?.nonBlockingGaps) ? run.nonBlockingGaps : [];
  const currentItems = Array.isArray(run?.currentItems)
    ? run.currentItems
    : Array.isArray(run?.currentTargets)
      ? run.currentTargets
      : [];
  const locked = shouldLockCreation(run);

  const stats = useMemo(
    () => [
      { label: '已完成', value: completed, color: '#326D54' },
      { label: '进行中', value: running, color: '#315C9B' },
      { label: '等待', value: waiting, color: '#6B7080' },
      { label: '失败', value: failed, color: failed > 0 ? '#9D4138' : '#6B7080' }
    ],
    [completed, failed, running, waiting]
  );

  if (!run) return null;

  const perform = async (name: string, action?: AnalysisAction) => {
    if (!action || pendingAction) return;
    setPendingAction(name);
    try {
      await action();
    } finally {
      setPendingAction('');
    }
  };

  const performConcurrencyChange = async (value: number) => {
    if (!onSetConcurrency || pendingAction) return;
    setPendingAction('concurrency');
    try {
      await onSetConcurrency(value);
    } finally {
      setPendingAction('');
    }
  };

  const renderActions = () => {
    if (status === 'analyzing') {
      return (
        <>
          <ActionButton
            label={run.pauseRequested ? '暂停中' : '平滑暂停'}
            icon={<CirclePauseIcon size={13} />}
            onClick={() => void perform('pause', onPause)}
            disabled={!onPause || Boolean(pendingAction) || Boolean(run.pauseRequested)}
          />
          <ActionButton
            label="取消本轮"
            icon={<SquareIcon size={11} fill="currentColor" />}
            onClick={() => void perform('cancel', onCancel)}
            disabled={!onCancel || Boolean(pendingAction)}
            danger
          />
        </>
      );
    }
    if (status === 'paused') {
      return (
        <>
          <ActionButton
            label="继续分析"
            icon={<CirclePlayIcon size={13} />}
            onClick={() => void perform('resume', onResume)}
            disabled={!onResume || Boolean(pendingAction)}
            emphasis
          />
          <ActionButton
            label="取消本轮"
            icon={<SquareIcon size={11} fill="currentColor" />}
            onClick={() => void perform('cancel', onCancel)}
            disabled={!onCancel || Boolean(pendingAction)}
            danger
          />
        </>
      );
    }
    if (status === 'failed' || status === 'degraded') {
      return (
        <ActionButton
          label={status === 'failed' ? '补跑失败项' : '补齐缺口'}
          icon={<RotateCcwIcon size={13} />}
          onClick={() => void perform('retry', onRetry)}
          disabled={!onRetry || Boolean(pendingAction)}
          emphasis={status === 'failed'}
        />
      );
    }
    if (status === 'uninitialized' || status === 'raw_imported' || status === 'cancelled') {
      return (
        <ActionButton
          label={status === 'uninitialized' ? '建立关系图谱' : status === 'cancelled' ? '重新开始' : '开始分析'}
          icon={status === 'cancelled' ? <RotateCcwIcon size={13} /> : <CirclePlayIcon size={13} />}
          onClick={() => void perform('start', onStart)}
          disabled={!onStart || Boolean(pendingAction)}
          emphasis
        />
      );
    }
    return null;
  };

  return (
    <section
      className={`relative overflow-hidden border-y ${className}`}
      aria-label="小说分析状态"
      style={{
        '--analysis-ink': colors.ink,
        '--analysis-wash': colors.wash,
        '--analysis-border': colors.border,
        backgroundColor: '#F9F6EC',
        backgroundImage: 'repeating-linear-gradient(0deg, transparent 0, transparent 27px, rgba(68, 78, 92, 0.035) 28px)',
        borderColor: colors.border,
        color: '#252C38',
        fontFamily: "'Noto Sans SC', sans-serif"
      } as React.CSSProperties}
    >
      <div className="flex min-h-[76px] items-center gap-4 px-5 py-3">
        <div
          className="hidden h-12 w-[74px] flex-shrink-0 rotate-[-1deg] flex-col items-center justify-center border sm:flex"
          style={{ borderColor: colors.border, background: '#FFFEFA', boxShadow: '2px 2px 0 rgba(49, 58, 73, 0.08)' }}
          aria-hidden="true"
        >
          <span className="text-[9px] tracking-[0.2em]" style={{ color: '#8A877D' }}>ANALYSIS</span>
          <span className="mt-0.5 font-mono text-[11px]" style={{ color: colors.ink }}>
            {run.workflowId || 'INDEX 01'}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium"
              style={{ borderColor: colors.border, background: colors.wash, color: colors.ink }}
              role="status"
              aria-live="polite"
            >
              <StatusIcon status={status} />
              {copy.shortLabel}
            </span>
            <h2 className="truncate font-serif text-[15px] font-medium tracking-wide" style={{ color: '#232A35' }}>
              {run.stageLabel || run.stage || copy.label}
            </h2>
            {locked && (
              <span className="text-[11px]" style={{ color: '#7A7468' }}>
                当前仅可查看
              </span>
            )}
          </div>
          <div className="mt-2 flex items-center gap-3">
            <div className="h-1.5 min-w-[120px] flex-1 overflow-hidden rounded-full" style={{ background: '#DDD8CA' }}>
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{ width: `${progress}%`, background: colors.ink }}
              />
            </div>
            <span className="w-10 text-right font-mono text-[11px] tabular-nums" style={{ color: colors.ink }}>
              {progress}%
            </span>
          </div>
          <p className="mt-1.5 truncate text-[11px]" style={{ color: '#747166' }}>
            {copy.description}
          </p>
        </div>

        <div className="hidden flex-shrink-0 items-center gap-4 xl:flex" aria-label="任务统计">
          {stats.map((stat) => (
            <div key={stat.label} className="min-w-[42px] text-center">
              <div className="font-mono text-sm font-semibold tabular-nums" style={{ color: stat.color }}>{stat.value}</div>
              <div className="mt-0.5 text-[10px]" style={{ color: '#8A877D' }}>{stat.label}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2">
          {renderActions()}
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            aria-expanded={expanded}
            aria-label={expanded ? '收起分析详情' : '展开分析详情'}
            className="flex h-8 w-8 items-center justify-center rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A7CF7]/35"
            style={{ borderColor: '#CEC8B8', background: '#FFFEFA', color: '#626779' }}
          >
            {expanded ? <ChevronUpIcon size={14} /> : <ChevronDownIcon size={14} />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="grid gap-4 border-t px-5 py-4 md:grid-cols-[minmax(0,1.4fr)_minmax(240px,0.6fr)]" style={{ borderColor: '#D9D3C5', background: 'rgba(255,254,250,0.78)' }}>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border bg-white/70 p-3" style={{ borderColor: '#DED8C9' }}>
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em]" style={{ color: '#8A877D' }}>
                <WorkflowIcon size={12} /> 流程
              </div>
              <p className="mt-2 truncate font-mono text-xs" style={{ color: '#354052' }}>{run.workflowId || '尚未分配'}</p>
              <p className="mt-1 truncate text-[11px]" style={{ color: '#777469' }}>{run.stageLabel || run.stage || copy.label}</p>
            </div>
            <div className="rounded-lg border bg-white/70 p-3" style={{ borderColor: '#DED8C9' }}>
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em]" style={{ color: '#8A877D' }}>
                <GaugeIcon size={12} /> 并发
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="font-mono text-xs" style={{ color: '#354052' }}>{actualConcurrency} 实际 /</span>
                <select
                  aria-label="最大分析并发"
                  value={maxConcurrency}
                  onChange={(event) => void performConcurrencyChange(Number(event.target.value))}
                  disabled={!onSetConcurrency || Boolean(pendingAction)}
                  className="h-7 rounded border bg-[#FFFEFA] px-1.5 font-mono text-xs outline-none focus:border-[#4A7CF7] disabled:opacity-50"
                  style={{ borderColor: '#CEC8B8', color: '#354052' }}
                >
                  {Array.from({ length: 8 }, (_, index) => index + 1).map((value) => (
                    <option key={value} value={value}>{value} 上限</option>
                  ))}
                </select>
              </div>
              <p className="mt-1 text-[11px]" style={{ color: '#777469' }}>系统会在限流时自动降速</p>
            </div>
            <div className="rounded-lg border bg-white/70 p-3 sm:col-span-2" style={{ borderColor: '#DED8C9' }}>
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em]" style={{ color: '#8A877D' }}>
                <LoaderCircleIcon size={12} /> 当前处理
              </div>
              <p className="mt-2 line-clamp-2 text-xs leading-5" style={{ color: '#354052' }}>
                {currentItems.length ? currentItems.join('、') : status === 'analyzing' ? '正在等待下一批任务回报' : '当前没有运行中的任务'}
              </p>
            </div>
          </div>

          <div className="rounded-lg border p-3" style={{ borderColor: blockingGaps.length ? '#E1B2AB' : '#DED8C9', background: blockingGaps.length ? '#FFF8F6' : '#FBFAF5' }}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium" style={{ color: blockingGaps.length ? '#9D4138' : '#4B5361' }}>分析缺口</span>
              <span className="font-mono text-[10px]" style={{ color: '#8A877D' }}>{blockingGaps.length} 关键 / {nonBlockingGaps.length} 非关键</span>
            </div>
            {run.error && <p className="mt-2 text-[11px] leading-5" style={{ color: '#9D4138' }}>{run.error}</p>}
            {blockingGaps.length + nonBlockingGaps.length > 0 ? (
              <ul className="mt-2 max-h-20 space-y-1 overflow-y-auto text-[11px] leading-4" style={{ color: '#656254' }}>
                {blockingGaps.map((gap) => <li key={`blocking-${gap}`}>• {gap}</li>)}
                {nonBlockingGaps.map((gap) => <li key={`optional-${gap}`}>· {gap}</li>)}
              </ul>
            ) : (
              <p className="mt-2 text-[11px]" style={{ color: '#777469' }}>尚未发现需要处理的缺口</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export type { AnalysisStatusBarProps };
