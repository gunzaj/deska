import type { Metadata } from "next";
import { Onboarding } from "@/components/github/onboarding";

export const metadata: Metadata = { title: "Connect GitHub" };
export const dynamic = "force-dynamic";

/** First run (SPEC D3): connect a fine-grained token. Step 2 (project and fields) comes with D4. */
export default function OnboardingPage() {
  return <Onboarding />;
}
