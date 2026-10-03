import Svg, { Circle, Defs, Ellipse, Path, RadialGradient, Stop } from 'react-native-svg';

const BODY_PATH =
  'M 855.2 368.8 Q 912 512, 864.05 664.05 Q 816.1 816.1, 664.05 854.05 ' +
  'Q 512 892, 367.05 846.95 Q 222.1 801.9, 169.55 656.95 Q 117 512, 166 363.5 ' +
  'Q 215 215, 363.5 171 Q 512 127, 655.2 176.3 Q 798.4 225.6, 855.2 368.8 Z';

type MascotMood = 'content' | 'thinking' | 'excited' | 'sad';

export function Mascot({ size = 96, mood = 'content' }: { size?: number; mood?: MascotMood }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 1024 1024">
      <Defs>
        <RadialGradient id="crumbBody" cx="38%" cy="32%" r="75%">
          <Stop offset="0%" stopColor="#F5BE63" />
          <Stop offset="55%" stopColor="#E8A33D" />
          <Stop offset="100%" stopColor="#D4892A" />
        </RadialGradient>
      </Defs>

      <Path fill="url(#crumbBody)" d={BODY_PATH} />

      <Circle cx={300} cy={300} r={12} fill="#B5651D" opacity={0.55} />
      <Circle cx={700} cy={280} r={9} fill="#B5651D" opacity={0.55} />
      <Circle cx={760} cy={420} r={7} fill="#B5651D" opacity={0.55} />
      <Circle cx={250} cy={500} r={8} fill="#B5651D" opacity={0.55} />
      <Circle cx={640} cy={680} r={10} fill="#B5651D" opacity={0.55} />
      <Circle cx={340} cy={700} r={7} fill="#B5651D" opacity={0.55} />

      <Ellipse cx={368} cy={570} rx={48} ry={26} fill="#F4A39A" opacity={mood === 'excited' ? 0.8 : 0.6} />
      <Ellipse cx={656} cy={570} rx={48} ry={26} fill="#F4A39A" opacity={mood === 'excited' ? 0.8 : 0.6} />

      {mood === 'sad' ? (
        <>
          <Ellipse cx={420} cy={480} rx={22} ry={22} fill="#2B1B12" />
          <Ellipse cx={604} cy={480} rx={22} ry={22} fill="#2B1B12" />
          <Path d="M 432 596 Q 512 556 592 596" fill="none" stroke="#2B1B12" strokeWidth={14} strokeLinecap="round" />
        </>
      ) : mood === 'thinking' ? (
        <>
          <Ellipse cx={420} cy={470} rx={10} ry={26} fill="#2B1B12" />
          <Ellipse cx={604} cy={486} rx={26} ry={10} fill="#2B1B12" />
          <Path d="M 452 576 Q 512 596 572 568" fill="none" stroke="#2B1B12" strokeWidth={12} strokeLinecap="round" />
        </>
      ) : (
        <>
          <Ellipse cx={420} cy={478} rx={26} ry={34} fill="#2B1B12" />
          <Ellipse cx={604} cy={478} rx={26} ry={34} fill="#2B1B12" />
          <Circle cx={428} cy={466} r={7} fill="#FFFFFF" />
          <Circle cx={612} cy={466} r={7} fill="#FFFFFF" />
          <Path
            d="M 432 556 Q 512 616 592 556"
            fill="none"
            stroke="#2B1B12"
            strokeWidth={14}
            strokeLinecap="round"
          />
        </>
      )}
    </Svg>
  );
}
