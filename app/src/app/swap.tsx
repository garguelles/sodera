import { PlatinumFeaturePreview } from '@/components/platinum-feature-preview';

export default function SwapRoute() {
  return (
    <PlatinumFeaturePreview
      title="Swap"
      symbol="⇄"
      description="Move between assets without leaving your everyday space."
      steps={['Choose the assets', 'Review a live quote and network costs', 'Approve with your passkey']}
    />
  );
}
