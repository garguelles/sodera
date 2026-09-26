import Svg, { Circle, Path, Text as SvgText } from 'react-native-svg';

import { platinum } from '@/constants/theme';

export function AssetLogo({ asset, size = 40 }: { asset: 'ETH' | 'USDC'; size?: number }) {
  return asset === 'ETH' ? (
    <Svg height={size} viewBox="0 0 40 40" width={size}>
      <Circle cx="20" cy="20" r="20" fill={platinum.colors.surfaceHigh} />
      <Path d="M20 5 10 21l10-4 10 4L20 5Z" fill={platinum.colors.platinum} />
      <Path d="m10 24 10 12 10-12-10 5-10-5Z" fill={platinum.colors.ethereum} />
      <Path d="m10 21 10-4v12l-10-8Z" fill={platinum.colors.ethereum} />
    </Svg>
  ) : (
    <Svg height={size} viewBox="0 0 40 40" width={size}>
      <Circle cx="20" cy="20" r="20" fill={platinum.colors.cyan} />
      <Circle cx="20" cy="20" r="16" fill="none" stroke={platinum.colors.platinum} strokeWidth="1.5" />
      <SvgText fill={platinum.colors.platinum} fontSize="27" fontWeight="600" textAnchor="middle" x="20" y="29">$</SvgText>
    </Svg>
  );
}
