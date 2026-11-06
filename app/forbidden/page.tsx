import { Logo } from "@/components/icons";
import { displayOrg } from "@/lib/config";
import { accessMode } from "@/lib/allowlist";
import { signOut } from "@/lib/auth";

export default function ForbiddenPage() {
  const reason =
    accessMode() === "org"
      ? `Your GitHub account is signed in but is not an active member of the ${displayOrg()} organization, or GitHub could not confirm it.`
      : "Your GitHub account is signed in but not on the Deska allowlist.";
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-8 text-center shadow-modal">
        <div className="flex justify-center">
          <Logo size={36} />
        </div>
        <h1 className="mt-5 text-[18px] font-semibold tracking-tight">Not allowed</h1>
        <p className="mt-2 text-muted">{reason}</p>
        {/* A denial is stored in the session, so signing in again is how to retry. */}
        <form
          className="mt-6"
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/signin" });
          }}
        >
          <button type="submit" className="text-[13px] font-medium text-brand-text hover:underline">
            Sign out and try again
          </button>
        </form>
      </div>
    </main>
  );
}
