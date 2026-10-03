// Lightweight unique id for storage filenames — doesn't need to be a real UUID,
// just unique enough to avoid collisions within one adventure/stop folder.
export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
