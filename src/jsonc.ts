/**
 * Minimal JSONC (JSON with comments and trailing commas) parser and editor.
 *
 * Used by `posteverywhere connect` to add or remove ONE member inside an
 * agent's settings file without touching anything else: comments, ordering,
 * formatting and other servers are kept byte for byte. Every edit is checked
 * by re-parsing the result and comparing it to the expected value; if that
 * check fails the caller must refuse to write.
 *
 * Zero dependencies on purpose (the CLI has no runtime dependencies).
 */

export interface JNode {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
  start: number;
  end: number; // exclusive
  value: unknown;
  props?: JProp[];
}

export interface JProp {
  key: string;
  keyStart: number;
  value: JNode;
  commaAfter: number; // index of the ',' after this member, or -1
}

export class JsoncError extends Error {}

export function parseJsonc(text: string): { root: JNode | null; value: unknown; hasComments: boolean } {
  let i = 0;
  let hasComments = false;
  const n = text.length;

  const err = (msg: string): never => { throw new JsoncError(`${msg} at offset ${i}`); };

  function skip() {
    while (i < n) {
      const c = text[i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '﻿') { i++; continue; }
      if (c === '/' && text[i + 1] === '/') {
        hasComments = true;
        while (i < n && text[i] !== '\n') i++;
        continue;
      }
      if (c === '/' && text[i + 1] === '*') {
        hasComments = true;
        const close = text.indexOf('*/', i + 2);
        if (close === -1) err('Unterminated comment');
        i = close + 2;
        continue;
      }
      break;
    }
  }

  function parseString(): JNode {
    const start = i;
    i++; // opening quote
    while (i < n && text[i] !== '"') {
      if (text[i] === '\\') i++;
      if (text[i] === '\n') err('Newline in string');
      i++;
    }
    if (i >= n) err('Unterminated string');
    i++;
    let value: unknown;
    try { value = JSON.parse(text.slice(start, i)); } catch { err('Bad string'); }
    return { type: 'string', start, end: i, value };
  }

  function parseValue(): JNode {
    skip();
    const c = text[i];
    const start = i;
    if (c === '{') {
      i++;
      const props: JProp[] = [];
      const obj: Record<string, unknown> = {};
      skip();
      while (text[i] !== '}') {
        if (text[i] !== '"') err('Expected property name');
        const keyNode = parseString();
        skip();
        if (text[i] !== ':') err('Expected ":"');
        i++;
        const value = parseValue();
        skip();
        let commaAfter = -1;
        if (text[i] === ',') { commaAfter = i; i++; skip(); }
        else if (text[i] !== '}') err('Expected "," or "}"');
        props.push({ key: keyNode.value as string, keyStart: keyNode.start, value, commaAfter });
        obj[keyNode.value as string] = value.value;
      }
      i++;
      return { type: 'object', start, end: i, value: obj, props };
    }
    if (c === '[') {
      i++;
      const arr: unknown[] = [];
      skip();
      while (text[i] !== ']') {
        arr.push(parseValue().value);
        skip();
        if (text[i] === ',') { i++; skip(); }
        else if (text[i] !== ']') err('Expected "," or "]"');
      }
      i++;
      return { type: 'array', start, end: i, value: arr };
    }
    if (c === '"') return parseString();
    const lit = /^(?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i, i + 64));
    if (!lit) err('Unexpected character');
    i += lit![0].length;
    const v = JSON.parse(lit![0]);
    return { type: v === null ? 'null' : typeof v === 'boolean' ? 'boolean' : 'number', start, end: i, value: v };
  }

  skip();
  if (i >= n) return { root: null, value: undefined, hasComments };
  const root = parseValue();
  skip();
  if (i < n) err('Unexpected content after the end');
  return { root, value: root.value, hasComments };
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every(k => deepEqual((a as any)[k], (b as any)[k]));
}

function lineIndent(text: string, pos: number): string {
  const ls = text.lastIndexOf('\n', pos - 1) + 1;
  return /^[ \t]*/.exec(text.slice(ls))![0];
}

function detectIndentUnit(text: string): string {
  let best: string | null = null;
  for (const m of text.matchAll(/\n([ \t]+)"/g)) {
    if (best === null || m[1].length < best.length) best = m[1];
  }
  return best || '  ';
}

function render(value: unknown, indent: string, unit: string): string {
  return JSON.stringify(value, null, unit).split('\n').join('\n' + indent);
}

function findProp(node: JNode | undefined, key: string): JProp | undefined {
  return node?.props?.find(p => p.key === key);
}

export type EditOutcome =
  | { kind: 'unchanged'; text: string }
  | { kind: 'changed'; text: string }
  | { kind: 'refused'; reason: string };

/**
 * Set root[container][key] = value. Creates the container if missing.
 * Never rewrites anything outside the inserted or replaced span.
 */
export function setMember(text: string, container: string, key: string, value: unknown): EditOutcome {
  let parsed;
  try { parsed = parseJsonc(text); } catch (e) { return { kind: 'refused', reason: `could not parse the file (${(e as Error).message})` }; }
  if (!parsed.root) {
    return { kind: 'changed', text: JSON.stringify({ [container]: { [key]: value } }, null, 2) + '\n' };
  }
  const root = parsed.root;
  if (root.type !== 'object') return { kind: 'refused', reason: 'the file is not a JSON object' };
  const unit = detectIndentUnit(text);
  const cProp = findProp(root, container);
  if (cProp && cProp.value.type !== 'object') return { kind: 'refused', reason: `"${container}" is not an object` };

  let next: string;
  const existing = findProp(cProp?.value, key);
  if (existing) {
    if (deepEqual(existing.value.value, value)) return { kind: 'unchanged', text };
    const ind = lineIndent(text, existing.keyStart);
    next = text.slice(0, existing.value.start) + render(value, ind, unit) + text.slice(existing.value.end);
  } else if (cProp) {
    next = insertInto(text, cProp.value, key, value, unit);
  } else {
    next = insertInto(text, root, container, { [key]: value }, unit);
  }

  const expected = { ...(parsed.value as object), [container]: { ...((cProp?.value.value as object) || {}), [key]: value } };
  return verify(next, expected);
}

function insertInto(text: string, obj: JNode, key: string, value: unknown, unit: string): string {
  const baseIndent = lineIndent(text, obj.start);
  const ind = baseIndent + unit;
  const member = `"${key}": ${render(value, ind, unit)}`;
  const at = obj.start + 1;
  if (obj.props && obj.props.length) {
    return text.slice(0, at) + `\n${ind}${member},` + text.slice(at);
  }
  // Empty object: put the member on its own line and close on the next.
  const inner = text.slice(at, obj.end - 1);
  if (/^\s*$/.test(inner)) {
    return text.slice(0, at) + `\n${ind}${member}\n${baseIndent}` + text.slice(obj.end - 1);
  }
  // Empty object that only holds comments: keep them, add after.
  return text.slice(0, obj.end - 1).replace(/\s*$/, '') + `\n${ind}${member}\n${baseIndent}` + text.slice(obj.end - 1);
}

/**
 * Remove root[container][key]. If the container is then empty, the container
 * member is removed too (so connect then remove leaves the file as it was).
 */
export function removeMember(text: string, container: string, key: string): EditOutcome {
  let parsed;
  try { parsed = parseJsonc(text); } catch (e) { return { kind: 'refused', reason: `could not parse the file (${(e as Error).message})` }; }
  const root = parsed.root;
  if (!root) return { kind: 'unchanged', text };
  if (root.type !== 'object') return { kind: 'refused', reason: 'the file is not a JSON object' };
  const cProp = findProp(root, container);
  if (!cProp || cProp.value.type !== 'object') return { kind: 'unchanged', text };
  const prop = findProp(cProp.value, key);
  if (!prop) return { kind: 'unchanged', text };

  let next: string;
  const expected: Record<string, unknown> = { ...(parsed.value as object) };
  const remaining = { ...(cProp.value.value as Record<string, unknown>) };
  delete remaining[key];
  if (cProp.value.props!.length === 1) {
    next = cutMember(text, root, cProp);
    delete expected[container];
  } else {
    next = cutMember(text, cProp.value, prop);
    expected[container] = remaining;
  }
  return verify(next, expected);
}

function cutMember(text: string, obj: JNode, prop: JProp): string {
  const idx = obj.props!.indexOf(prop);
  const lineStart = text.lastIndexOf('\n', prop.keyStart - 1);
  const onOwnLine = lineStart !== -1 && /^[ \t]*$/.test(text.slice(lineStart + 1, prop.keyStart));
  let from = onOwnLine ? lineStart : prop.keyStart;
  if (from < obj.start + 1) from = obj.start + 1;
  if (prop.commaAfter !== -1 && idx < obj.props!.length - 1) {
    return text.slice(0, from) + text.slice(prop.commaAfter + 1);
  }
  const prev = obj.props![idx - 1];
  if (prev && prev.commaAfter !== -1) {
    const end = prop.commaAfter !== -1 ? prop.commaAfter + 1 : prop.value.end;
    // Drop the previous member's comma but keep any comment after it.
    return text.slice(0, prev.commaAfter) + text.slice(prev.commaAfter + 1, from) + text.slice(end);
  }
  const end = prop.commaAfter !== -1 ? prop.commaAfter + 1 : prop.value.end;
  return text.slice(0, from) + text.slice(end);
}

function verify(next: string, expected: unknown): EditOutcome {
  try {
    const re = parseJsonc(next);
    if (deepEqual(re.value, expected)) return { kind: 'changed', text: next };
  } catch { /* fall through */ }
  return { kind: 'refused', reason: 'a safe edit could not be made (the result did not check out)' };
}
