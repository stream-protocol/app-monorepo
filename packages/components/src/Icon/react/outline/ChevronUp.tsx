import Svg, { SvgProps, Path } from 'react-native-svg';
const SvgChevronUp = (props: SvgProps) => (
  <Svg
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    accessibilityRole="image"
    {...props}
  >
    <Path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="m5 15 7-7 7 7"
    />
  </Svg>
);
export default SvgChevronUp;
