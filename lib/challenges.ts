// Generic photo challenges auto-assigned to custom-adventure stops.
export const CHALLENGES = [
  'Capture something that made you stop and look.',
  'Get everyone into one photo.',
  'Find something red and photograph it.',
  'Take a photo of something you would have walked right past before.',
  'Capture something in motion.',
  'Photograph the best detail you can find within 10 steps of here.',
  'Take a photo that shows what this place smells or sounds like.',
  'Recreate a pose from a famous painting or movie scene here.',
  'Capture your shadow in an interesting spot.',
  'Find the oldest-looking thing nearby and photograph it.',
  'Take a photo looking up.',
  'Photograph something small that most people would miss.',
  'Take a silly group photo.',
  'Capture the view exactly as you would describe it to a friend.',
  'Take a photo of the thing that made you smile here.',
];

export function randomChallenge(): string {
  return CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)];
}
