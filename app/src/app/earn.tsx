import { FeaturePreview } from '@/components/feature-preview';

export default function EarnRoute() {
  return (
    <FeaturePreview
      title="Earn"
      symbol="✳"
      description="A simpler way to discover what your assets can do, right from your phone."
      steps={['Explore opportunities', 'Understand the risks before committing', 'Track positions from your wallet']}
    />
  );
}
