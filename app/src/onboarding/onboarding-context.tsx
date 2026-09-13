import { createContext, type ReactNode, use, useEffect, useState } from 'react';

import {
  resolveOnboardingAccess,
  type OnboardingAccess,
  type OnboardingProfile,
} from './onboarding';
import { onboardingNativeStorage } from './onboarding-native-storage';
import { walletIdentityNativeStorage } from '@/wallet/wallet-identity-native-storage';

type OnboardingContextValue = {
  access: OnboardingAccess | null;
  complete(profile: OnboardingProfile): void;
  retry(): void;
};

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<OnboardingAccess | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void resolveOnboardingAccess({
      identityStorage: walletIdentityNativeStorage,
      profileStorage: onboardingNativeStorage,
    })
      .then((nextAccess) => {
        if (active) setAccess(nextAccess);
      })
      .catch((error) => {
        if (active) {
          setAccess({
            status: 'blocked',
            message: error instanceof Error ? error.message : 'Could not load onboarding state',
          });
        }
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  return (
    <OnboardingContext
      value={{
        access,
        complete: (profile) => setAccess({ status: 'complete', profile }),
        retry: () => {
          setAccess(null);
          setAttempt((value) => value + 1);
        },
      }}
    >
      {children}
    </OnboardingContext>
  );
}

export function useOnboarding() {
  const context = use(OnboardingContext);
  if (!context) throw new Error('useOnboarding must be used inside OnboardingProvider');
  return context;
}
