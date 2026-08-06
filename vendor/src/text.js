// text.js — Unified text formatter. Emits a bundled type class (font-size + its paired
// line-height=--leading) so the two can never drift. Tiers 3/4/5 all resolve to the
// --text-body floor by design (see styles.css/.t-lg note); only 1 (title) and 2 (heading)
// are larger. Depends on CSS variables set by computeLayout().

/**
 * Renders text with phi-scale sizing enforcement.
 * Font-size at tier n, line-height at tier n-1. You cannot have one without the other.
 *
 * @param {string} content - Text/HTML content
 * @param {number} tier - Phi-scale tier (3=lg, 4=md, 5=sm)
 * @param {object} [opts]
 * @param {string} [opts.font='cinzel'] - 'cinzel' or 'crimson'
 * @param {string} [opts.color] - CSS color
 * @param {number} [opts.opacity] - 0-1
 * @param {string|number} [opts.weight] - font-weight
 * @param {string} [opts.align] - text-align
 * @param {boolean} [opts.tabular] - tabular-nums
 * @param {boolean} [opts.uppercase] - text-transform:uppercase
 * @param {string} [opts.letterSpacing] - CSS letter-spacing
 * @param {string} [opts.extraStyle] - additional inline CSS
 * @param {string} [opts.tag='span'] - HTML tag
 * @param {boolean} [opts.block] - display:block
 * @param {string} [opts.cls] - CSS class(es)
 * @returns {string} HTML string
 */
function renderText(content, tier, opts) {
  opts = opts || {};
  // Size + PAIRED leading come from a bundled type CLASS defined once in
  // styles.css (.t-md, .t-lg, …) — the SAME single source static markup uses —
  // so font-size and line-height can never drift apart. Family: 'crimson'
  // inherits the <body> default; anything else is Cinzel display.
  const sizeClass = { 1:'t-xxl', 2:'t-xl', 3:'t-lg', 4:'t-md', 5:'t-sm' }[tier] || 't-md';
  const classes = [sizeClass];
  if (opts.font === 'cinzel') classes.push('t-display');
  if (opts.uppercase) classes.push('t-upper');
  if (opts.cls) classes.push(opts.cls);

  // Instance-specific styling (NOT the type scale) stays inline.
  let style = '';
  if (opts.color) style += 'color:' + opts.color + ';';
  if (opts.opacity !== undefined) style += 'opacity:' + opts.opacity + ';';
  if (opts.weight) style += 'font-weight:' + opts.weight + ';';
  if (opts.align) style += 'text-align:' + opts.align + ';';
  if (opts.tabular) style += 'font-variant-numeric:tabular-nums;';
  if (opts.letterSpacing) style += 'letter-spacing:' + opts.letterSpacing + ';';
  if (opts.block) style += 'display:block;';
  if (opts.extraStyle) style += opts.extraStyle + ';';

  const tag = opts.tag || 'span';
  const styleAttr = style ? ' style="' + style + '"' : '';
  return '<' + tag + ' class="' + classes.join(' ') + '"' + styleAttr + '>' + content + '</' + tag + '>';
}
