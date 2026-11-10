import { ReadModel } from "@/lib/sync/read-model";
import { MemoryStore } from "@/lib/sync/store-memory";
import { storeContract } from "./store-contract";

storeContract("MemoryStore", async () => {
  const store = new MemoryStore();
  return { store, read: async () => store as ReadModel, changes: async () => store.fieldChanges.map((c) => ({ issueNodeId: c.issueNodeId, field: c.field })) };
});
