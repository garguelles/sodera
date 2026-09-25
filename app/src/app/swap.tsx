import { FeaturePreview } from '@/components/feature-preview';

export default function SwapRoute() {
  return (
    <FeaturePreview
      title="Swap"
      symbol="⇄"
      description="Move between assets without leaving your everyday space."
      steps={['Choose the assets', 'Review a live quote and network costs', 'Approve with your passkey']}
    />
  );
}
