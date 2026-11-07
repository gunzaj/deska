import { redirect } from "next/navigation";
import { desktopGuard } from "@/lib/desktop/guard";
import { readTasksOnly } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function Home() {
  redirect(desktopGuard() && (await readTasksOnly()) ? "/tasks" : "/my");
}
