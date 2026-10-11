// Simple ID generator
let _counter = 0;
export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${(++_counter).toString(36)}`;
}
