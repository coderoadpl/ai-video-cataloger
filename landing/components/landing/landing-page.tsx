import BeforeAfterSection from "@/components/landing/before-after-section";
import CliSection from "@/components/landing/cli-section";
import CallToActionSection from "@/components/landing/cta-section";
import FaqSection from "@/components/landing/faq-section";
import FeaturesSection from "@/components/landing/features-section";
import HeroSection from "@/components/landing/hero-section";
import HowItWorksSection from "@/components/landing/how-it-works-section";
import Particles from "@/components/magicui/particles";
import type { Dictionary } from "@/lib/i18n";

export default function LandingPage({ dict }: { dict: Dictionary }) {
  return (
    <section lang={dict.locale}>
      <HeroSection dict={dict} />
      <BeforeAfterSection dict={dict} />
      <HowItWorksSection dict={dict} />
      <FeaturesSection dict={dict} />
      <CliSection dict={dict} />
      <FaqSection dict={dict} />
      <CallToActionSection dict={dict} />
      <Particles
        className="absolute inset-0 -z-10"
        quantity={50}
        ease={70}
        size={0.05}
        staticity={40}
        color={"#ffffff"}
      />
    </section>
  );
}
