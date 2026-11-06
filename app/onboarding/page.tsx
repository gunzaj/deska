import type { Metadata } from "next";
import { Onboarding } from "@/components/github/onboarding";

export const metadata: Metadata = { title: "Connect GitHub" };
export const dynamic = "force-dynamic";

/** First run (SPEC D3, D4): connect a fine-grained token, then choose the project and map its fields. */
export default function OnboardingPage() {
  return <Onboarding />;
}
