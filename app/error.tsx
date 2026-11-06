"use client";

export default function AppError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center">
      <div className="max-w-md">
        <h1 className="text-[18px] font-semibold tracking-tight">Something went wrong</h1>
        <p className="mt-2 break-words text-muted">{error.message}</p>
        <button
          type="button"
          onClick={reset}
          className="mt-5 inline-flex h-8 items-center rounded-md bg-brand px-3 font-semibold text-brand-on hover:bg-brand-hover"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
