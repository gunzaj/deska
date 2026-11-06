import { redirect } from "next/navigation";
import { getStore } from "@/lib/store";
import { resolveRelease } from "@/lib/views/rows";

/** Old /board links land on the current Release board. */
export default async function Board() {
  const id = resolveRelease(await getStore(), "current", new Date().toISOString().slice(0, 10));
  redirect(id ? `/releases/${id}` : "/backlog");
}
