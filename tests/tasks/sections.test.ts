// D13 on the in-memory task repo (the suite is shared with sections.pg.test.ts).
import { __resetTasks } from "@/lib/tasks/repo";
import { defineSectionTests } from "./sections-suite";

defineSectionTests(() => __resetTasks());
