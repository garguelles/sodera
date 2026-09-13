import { OnboardingScreen } from '@/components/onboarding-screen';
import { useOnboarding } from '@/onboarding/onboarding-context';

export default function OnboardingRoute() {
  const { access, complete, retry } = useOnboarding();
  return (
    <OnboardingScreen
      initialError={access?.status === 'blocked' ? access.message : undefined}
      onComplete={complete}
      onRetry={retry}
    />
  );
}
