// What each AI feature sends (SPEC §4.9 "Minimal, visible input"), as Settings → AI
// lists it. A feature's milestone adds its row when it ships; the text here is
// the promise, and the feature's tests check the prompt against it.
export type AiFeatureInfo = { id: string; name: string; sends: string; milestone: string };

export const AI_FEATURES: readonly AiFeatureInfo[] = [
  { id: "issue-triage", name: "Issue triage", milestone: "AI1", sends: "The issue's title, body and comments (trimmed), its labels and the repository's labels (names and IDs), its mapped project fields with their options, its parent, and up to 10 possible duplicates (number, title and state)." },
  { id: "task-assist", name: "Task assist", milestone: "AI2", sends: "The text you typed (or the Inbox tasks), the names of your task projects, sections and labels, and titles of cached issues that share words with it." },
  { id: "plan-my-day", name: "Plan my day", milestone: "AI3", sends: "Open tasks that are overdue or due within 7 days, Inbox tasks, and open issues assigned to you in the current sprint: their titles, due dates and times, priority, project names, issue numbers, state, milestone due dates and snooze dates." },
  { id: "ask", name: "Ask", milestone: "AI4", sends: "The issue as for triage, or up to 200 rows of an issue list (number, title, state, mapped fields, labels), and your question." },
  { id: "ramble", name: "Ramble", milestone: "Item 13", sends: "The transcript of your recording, and the names of your task projects, sections and labels. The recording itself goes only to your transcription endpoint." },
];

/** Never sent, for any feature. */
export const AI_NEVER_SENT = "Your GitHub token, the API keys, your recordings (they go only to the transcription endpoint), backups, settings, and tasks a feature does not need.";

export const AI_DESTINATIONS = {
  "claude-code": "Sent to Anthropic through the Claude Code CLI, under your own Claude account.",
  openai: "Sent to the endpoint you set. A server on this machine or your own network keeps it there; any other endpoint receives it over https.",
} as const;
