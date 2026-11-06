import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center">
      <div>
        <p className="font-mono text-faint">404</p>
        <h1 className="mt-2 text-[18px] font-semibold tracking-tight">Not found</h1>
        <Link href="/my" className="mt-5 inline-flex h-8 items-center rounded-md bg-brand px-3 font-semibold text-brand-on hover:bg-brand-hover">
          Go to my issues
        </Link>
      </div>
    </main>
  );
}
