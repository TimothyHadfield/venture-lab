// Event bus — pub/sub replacing monkey-patching.
// Engine emits named events, subscribers react independently.
// No wrapper chains, no load-order dependency.

const _listeners = {};

function on(name, fn) {
  (_listeners[name] ||= []).push(fn);
}

function off(name, fn) {
  const list = _listeners[name];
  if (!list) return;
  const index = list.indexOf(fn);
  if (index >= 0) list.splice(index, 1);
}

function emit(name, data) {
  (_listeners[name] || []).forEach(fn => fn(data));
}

function clear() {
  for (const key in _listeners) delete _listeners[key];
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { on, off, emit, clear };
}
