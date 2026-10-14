import Link from 'next/link';
import type { Metadata } from 'next';
import type { JobStatus } from '@tradeflow/shared';
import { requireClient } from '@/lib/session';
import { load } from '@/lib/load';
import { listJobs } from '@/lib/resources';
import { assignableEngineers } from '@/lib/roster';
import { buildHref, enumParam, firstParam, type RawSearchParams } from '@/lib/url';
import {
  businessDayRange,
  formatDate,
  formatDayHeading,
  formatDuration,
  formatTime,
  fromZonedInputValue,
  toIsoDate,
  zonedDateParts,
} from '@/lib/format';
import type { Job } from '@/lib/read-models';
import {
  EmptyState,
  ErrorPanel,
  FilterChips,
  JobStatusPill,
  PageHeader,
  Panel,
} from '@/components/ui';

export const metadata: Metadata = { title: 'Jobs' };

const STATUSES: JobStatus[] = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

/** `?from=YYYY-MM-DD`, defaulting to today, so the view is a shareable link. */
function rangeFromParam(value: string, days: number): { from: Date; to: Date } | null {
  const start = fromZonedInputValue(`${value}T00:00`);
  if (!start) return null;
  const [year, month, day] = zonedDateParts(start);
  const end = fromZonedInputValue(
    `${toIsoDate(new Date(Date.UTC(year, month - 1, day + days)))}T00:00`,
  );
  return end ? { from: start, to: end } : null;
}

function shiftDays(value: string, days: number): string {
  const start = fromZonedInputValue(`${value}T00:00`);
  const base = start ?? new Date();
  const [year, month, day] = zonedDateParts(base);
  return toIsoDate(new Date(Date.UTC(year, month - 1, day + days)));
}

/** Group by the business day a job starts on, in the office's timezone. */
function groupByDay(jobs: Job[]): { key: string; label: string; jobs: Job[] }[] {
  const groups = new Map<string, Job[]>();
  for (const job of jobs) {
    const key = toIsoDate(job.scheduledStart);
    const bucket = groups.get(key);
    if (bucket) bucket.push(job);
    else groups.set(key, [job]);
  }
  return Array.from(groups, ([key, dayJobs]) => ({
    key,
    label: formatDayHeading(dayJobs[0]?.scheduledStart ?? key),
    jobs: dayJobs.sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart)),
  })).sort((a, b) => a.key.localeCompare(b.key));
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const today = toIsoDate(new Date());

  const fromParam = firstParam(params, 'from') || toIsoDate(businessDayRange().from);
  const range = rangeFromParam(fromParam, 7) ?? rangeFromParam(today, 7)!;
  const status = enumParam(params, 'status', STATUSES);
  const assigneeId = firstParam(params, 'assigneeId');

  const client = await requireClient();
  const result = await load(() =>
    listJobs(client, {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      limit: 500,
      ...(status ? { status } : {}),
      ...(assigneeId ? { assigneeId } : {}),
    }),
  );

  const jobs = result.ok ? result.data : [];
  const engineers = await assignableEngineers(client, jobs);
  const groups = groupByDay(jobs);
  const hrefFor = (patch: Record<string, string | null>) => buildHref('/jobs', params, patch);
  const lastDay = shiftDays(fromParam, 6);

  let totalMinutes = 0;
  for (const job of jobs) {
    totalMinutes += Math.max(
      0,
      (new Date(job.scheduledEnd).getTime() - new Date(job.scheduledStart).getTime()) / 60_000,
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Jobs"
        subtitle={
          <>
            <span className="num">{formatDate(range.from)}</span> to{' '}
            <span className="num">{formatDate(new Date(range.to.getTime() - 1))}</span>
            {result.ok && (
              <>
                {' · '}
                {jobs.length} {jobs.length === 1 ? 'job' : 'jobs'} · {(totalMinutes / 60).toFixed(1)}h booked
              </>
            )}
          </>
        }
        actions={
          <>
            <Link className="btn" href={hrefFor({ from: shiftDays(fromParam, -7) })}>
              ← Previous
            </Link>
            <Link className="btn" href="/jobs">
              This week
            </Link>
            <Link className="btn" href={hrefFor({ from: shiftDays(fromParam, 7) })}>
              Next →
            </Link>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <FilterChips
          active={status ?? ''}
          options={[
            { value: '', label: 'All' },
            ...STATUSES.map((value) => ({
              value,
              label: value.charAt(0) + value.slice(1).toLowerCase().replace('_', ' '),
            })),
          ]}
          hrefFor={(value) => hrefFor({ status: value || null })}
        />

        {engineers.length > 0 && (
          <form action="/jobs" method="get" className="flex items-center gap-2">
            <input type="hidden" name="from" value={fromParam} />
            {status && <input type="hidden" name="status" value={status} />}
            <label className="text-xs text-ink-faint" htmlFor="assigneeId">
              Engineer
            </label>
            <select id="assigneeId" name="assigneeId" className="control w-44" defaultValue={assigneeId}>
              <option value="">Anyone</option>
              {engineers.map((engineer) => (
                <option key={engineer.id} value={engineer.id}>
                  {engineer.name}
                </option>
              ))}
            </select>
            <button className="btn" type="submit">
              Apply
            </button>
            {assigneeId && (
              <Link className="btn btn-ghost" href={hrefFor({ assigneeId: null })}>
                Clear
              </Link>
            )}
          </form>
        )}

        <span className="ml-auto text-xs text-ink-faint">
          {firstParam(params, 'from') ? (
            <Link className="link underline decoration-line-strong" href="/jobs">
              Back to this week
            </Link>
          ) : (
            <span>Showing the seven days from today.</span>
          )}
        </span>
      </div>

      {!result.ok ? (
        <ErrorPanel title="Jobs did not load" detail={`${result.problem.code}: ${result.problem.message}`} />
      ) : groups.length === 0 ? (
        <Panel>
          <EmptyState
            title="No jobs in this window"
            description="Jobs appear here once an accepted quote is booked in. Try a wider date range or clear the filters."
            action={
              <Link className="btn btn-sm" href="/quotes?status=ACCEPTED">
                Accepted quotes waiting to be scheduled
              </Link>
            }
          />
        </Panel>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <Panel
              key={group.key}
              title={group.label}
              description={`${group.jobs.length} ${group.jobs.length === 1 ? 'job' : 'jobs'}`}
              bodyClassName="p-0"
            >
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th className="w-28">Time</th>
                      <th className="w-24">Job</th>
                      <th>Customer</th>
                      <th>Site</th>
                      <th>Engineer</th>
                      <th className="w-20 right">Length</th>
                      <th className="right">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.jobs.map((job) => (
                      <tr key={job.id}>
                        <td className="num whitespace-nowrap text-ink-dim">
                          {formatTime(job.scheduledStart)}–{formatTime(job.scheduledEnd)}
                        </td>
                        <td>
                          <Link className="link font-medium" href={`/jobs/${job.id}`}>
                            {job.number}
                          </Link>
                        </td>
                        <td className="truncate">{job.customer.name}</td>
                        <td className="truncate text-ink-dim">{job.site?.label ?? '—'}</td>
                        <td className="text-ink-dim">
                          {job.assignee?.name ?? <span className="text-warn">Unassigned</span>}
                        </td>
                        <td className="num right text-ink-faint">
                          {formatDuration(job.scheduledStart, job.scheduledEnd)}
                        </td>
                        <td className="right">
                          <JobStatusPill status={job.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
