import type { ApiClient } from './api';
import { listUsers } from './resources';
import type { Job, UserRef } from './read-models';

/**
 * Who can be assigned to a job.
 *
 * `docs/api-routes.md` documents no users endpoint, but "assign an engineer"
 * needs names and a `JobCreate` needs a `userId`. `/users?role=ENGINEER` is the
 * guess; the fallback is not a guess but an observation — every job the API has
 * already returned carries its assignee, so the people who have been scheduled
 * before are a real roster even when the endpoint is missing.
 *
 * The result is deduplicated by id and sorted for a stable picker, because the
 * alternative — an empty dropdown — would make the demo's step 6 impossible.
 */
export async function assignableEngineers(client: ApiClient, jobs: Job[]): Promise<UserRef[]> {
  const seen = new Map<string, UserRef>();

  try {
    for (const user of await listUsers(client, 'ENGINEER')) {
      seen.set(user.id, user);
    }
  } catch {
    // No `/users` route (or no permission for it). The job feed below still
    // gives us real ids and names.
  }

  for (const job of jobs) {
    if (job.assignee?.id && !seen.has(job.assignee.id)) {
      seen.set(job.assignee.id, job.assignee);
    }
  }

  return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
}
