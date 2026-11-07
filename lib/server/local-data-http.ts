// Shared by the /api/local-data routes: a LocalDataError becomes its status.
import { HttpError } from "./route";
import { LocalDataError } from "../backup/local-data";

/** Runs `fn`; a `LocalDataError` is answered with its message and status, anything else is a 500 as usual. */
export async function localData<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof LocalDataError) throw new HttpError(e.status, e.message);
    throw e;
  }
}
