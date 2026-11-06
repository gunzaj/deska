import { IssuePage } from "@/components/pages/issue";

export default async function Page({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  return <IssuePage number={Number(number)} />;
}
