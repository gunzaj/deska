import { exportLocalData } from "@/lib/backup/local-data";
import { localData } from "@/lib/server/local-data-http";
import { route } from "@/lib/server/route";

export const dynamic = "force-dynamic";

/** Settings → Export: every local-only table as one JSON file (D8). No GitHub cache, no token. */
export const GET = route({ auth: "public" }, () =>
  localData(async () => {
    const data = await exportLocalData();
    return new Response(JSON.stringify(data), {
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="deska-export-${data.createdAt.slice(0, 10)}.json"`,
      },
    });
  }),
);
