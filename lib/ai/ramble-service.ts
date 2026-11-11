// Ramble (item 13), assembled on the server: the transcript and the clock from
// the page, plus the user's active projects with their sections and the labels.
// The model is asked only here, when the user asks; its rows are text until the
// user creates them in one batch.
import { LOCAL_OWNER } from "../local-owner";
import { listTasks } from "../tasks/service";
import { startJob, type Job } from "./runner";
import { rambleHash, rambleTask, type RambleInput, type RambleProject } from "./ramble";
import type { TaskClock } from "./task-clock";

async function projects(): Promise<{ projects: RambleProject[]; labels: { id: string; name: string }[] }> {
  const { projects, sections, labels } = await listTasks(LOCAL_OWNER);
  return {
    projects: projects
      .filter((p) => !p.archived)
      .map((p) => ({
        id: p.id,
        name: p.name,
        sections: sections
          .filter((s) => s.projectId === p.id)
          .sort((a, b) => a.position - b.position)
          .map((s) => ({ id: s.id, name: s.name })),
      })),
    labels: labels.map((l) => ({ id: l.id, name: l.name })),
  };
}

/** One parse job for a transcript; an error job when AI is off or untested (nothing is sent). */
export async function startRamble(transcript: string, clock: TaskClock): Promise<Job> {
  const choices = await projects();
  const input: RambleInput = {
    transcript,
    today: clock.today,
    now: clock.now,
    tz: clock.tz,
    projects: choices.projects,
    labels: choices.labels,
    subjectVersion: rambleHash(transcript),
  };
  return startJob(rambleTask(input));
}
