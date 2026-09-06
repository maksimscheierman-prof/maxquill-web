"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const VOID = new Set(["meta", "link", "input", "br", "hr", "img"]);
const rootDir = path.join(__dirname, "..");

class MiniEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = Boolean(init.bubbles);
    this.cancelable = Boolean(init.cancelable);
    this.defaultPrevented = false;
    this.target = init.target || null;
    this.currentTarget = null;
  }
  preventDefault() { this.defaultPrevented = true; }
}

class TextNode {
  constructor(text) {
    this.nodeType = 3;
    this.textContent = String(text);
    this.parentElement = null;
    this.parentNode = null;
    this.childNodes = [];
    this.children = [];
  }
}

function camelData(name) {
  return name.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
}

function parseAttrs(raw) {
  const attrs = {};
  const re = /([:@A-Za-z_][\w:-]*)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match;
  while ((match = re.exec(raw || ""))) attrs[match[1]] = match[2] ?? match[3] ?? match[4] ?? "";
  return attrs;
}

class El {
  constructor(tag, attrs = {}, ownerDocument = null) {
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.parentElement = null;
    this.parentNode = null;
    this.childNodes = [];
    this.children = this.childNodes;
    this.attributes = { ...attrs };
    this.dataset = {};
    this.style = {};
    this.hidden = Object.prototype.hasOwnProperty.call(attrs, "hidden");
    this.disabled = Object.prototype.hasOwnProperty.call(attrs, "disabled");
    this.open = false;
    this.className = attrs.class || "";
    this.id = attrs.id || "";
    this.name = attrs.name || "";
    this.type = attrs.type || "";
    this.content = attrs.content || "";
    this.value = attrs.value || "";
    this.offsetWidth = 40;
    this.offsetHeight = 20;
    this._listeners = new Map();
    for (const [key, value] of Object.entries(attrs)) {
      if (key.startsWith("data-")) this.dataset[camelData(key)] = value;
    }
  }
  get textContent() {
    if (!this.childNodes.length) return "";
    return this.childNodes.map((child) => child.textContent).join("");
  }
  set textContent(value) {
    this.childNodes.length = 0;
    this.append(new TextNode(value == null ? "" : String(value)));
  }
  get innerHTML() { return this.childNodes.map((child) => child.outerHTML || child.textContent).join(""); }
  set innerHTML(html) {
    this.childNodes.length = 0;
    for (const child of parseFragment(String(html || ""), this.ownerDocument)) this.append(child);
  }
  get outerHTML() { return `<${this.tagName.toLowerCase()}>`; }
  append(...nodes) {
    for (const node of nodes) {
      node.parentElement = this;
      node.parentNode = this;
      if (node.nodeType === 1) node.ownerDocument = this.ownerDocument;
      this.childNodes.push(node);
    }
  }
  replaceChildren(...nodes) {
    this.childNodes.length = 0;
    this.append(...nodes);
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; }
  hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name); }
  matches(selector) { return matchSelector(this, selector); }
  closest(selector) {
    let node = this;
    while (node && node.nodeType === 1) {
      if (node.matches(selector)) return node;
      node = node.parentElement;
    }
    return null;
  }
  contains(node) {
    let current = node;
    while (current) {
      if (current === this) return true;
      current = current.parentElement || current.parentNode;
    }
    return false;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const found = [];
    walk(this, (node) => { if (node !== this && node.nodeType === 1 && node.matches(selector)) found.push(node); });
    return found;
  }
  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
  }
  dispatchEvent(event) {
    if (!event.target) event.target = this;
    event.currentTarget = this;
    for (const fn of this._listeners.get(event.type) || []) fn(event);
    if (event.bubbles && this.parentElement) this.parentElement.dispatchEvent(event);
    else if (event.bubbles && this.ownerDocument && this.parentElement == null) this.ownerDocument.emit(event);
    return !event.defaultPrevented;
  }
  focus() {
    const selection = this.ownerDocument?.defaultView?.getSelection?.();
    selection?.removeAllRanges?.();
    this.ownerDocument?.dispatchEvent(new MiniEvent("selectionchange", { bubbles: true }));
  }
  showModal() { this.open = true; }
  close() { this.open = false; }
  scrollIntoView() {}
}

function walk(node, visit) {
  visit(node);
  for (const child of node.childNodes || []) walk(child, visit);
}

function matchSelector(el, selector) {
  if (selector.startsWith("#")) return el.id === selector.slice(1);
  if (selector.startsWith(".")) return (` ${el.className} `).includes(` ${selector.slice(1)} `);
  const taggedAttr = selector.match(/^([a-z][\w-]*)\[([^=\]]+)="([^"]*)"\]$/i);
  if (taggedAttr) return el.tagName === taggedAttr[1].toUpperCase() && el.getAttribute(taggedAttr[2]) === taggedAttr[3];
  const eqAttr = selector.match(/^\[([^=\]]+)="([^"]*)"\]$/);
  if (eqAttr) return el.getAttribute(eqAttr[1]) === eqAttr[2] || el.dataset[camelData(eqAttr[1])] === eqAttr[2];
  const attr = selector.match(/^\[([^\]]+)\]$/);
  if (attr) {
    const name = attr[1];
    if (name.startsWith("data-")) return Object.prototype.hasOwnProperty.call(el.dataset, camelData(name));
    return el.hasAttribute(name);
  }
  return el.tagName === selector.toUpperCase();
}

function parseFragment(html, ownerDocument) {
  const root = { childNodes: [], append(node) { this.childNodes.push(node); } };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/([a-zA-Z][\w:-]*)>|<(?:([a-zA-Z][\w:-]*))([^>]*)\/?>|([^<]+)/gi;
  let match;
  while ((match = re.exec(html))) {
    if (match[1]) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (match[2]) {
      const tag = match[2].toLowerCase();
      const node = new El(tag, parseAttrs(match[3]), ownerDocument);
      stack[stack.length - 1].append(node);
      if (!VOID.has(tag) && !String(match[0]).endsWith("/>")) stack.push(node);
      continue;
    }
    if (match[4] && match[4].trim()) stack[stack.length - 1].append(new TextNode(match[4]));
  }
  return root.childNodes.filter((node) => node.nodeType === 1);
}

class MiniDocument {
  constructor(html) {
    this._listeners = new Map();
    this._title = "";
    this.nodeType = 9;
    this.defaultView = null;
    const nodes = parseFragment(html, this);
    this.documentElement = nodes.find((node) => node.tagName === "HTML") || nodes[0];
    this.documentElement.ownerDocument = this;
    walk(this.documentElement, (node) => { if (node.nodeType === 1) node.ownerDocument = this; });
    this.body = this.documentElement.querySelector("body");
  }
  get title() { return this._title; }
  set title(value) { this._title = value; }
  createElement(tag) { return new El(tag, {}, this); }
  createTextNode(text) { return new TextNode(text); }
  querySelector(selector) { return this.documentElement.matches(selector) ? this.documentElement : this.documentElement.querySelector(selector); }
  querySelectorAll(selector) {
    const found = [];
    walk(this.documentElement, (node) => { if (node.nodeType === 1 && node.matches(selector)) found.push(node); });
    return found;
  }
  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
  }
  emit(event) {
    event.currentTarget = this;
    for (const fn of this._listeners.get(event.type) || []) fn(event);
  }
  dispatchEvent(event) {
    if (!event.target) event.target = this;
    this.emit(event);
    return !event.defaultPrevented;
  }
}

class MiniRange {
  constructor() {
    this.startContainer = null;
    this.startOffset = 0;
    this.endContainer = null;
    this.endOffset = 0;
  }
  cloneRange() {
    const range = new MiniRange();
    range.startContainer = this.startContainer;
    range.startOffset = this.startOffset;
    range.endContainer = this.endContainer;
    range.endOffset = this.endOffset;
    return range;
  }
  selectNodeContents(el) {
    const text = (el.childNodes || []).find((child) => child.nodeType === 3) || el;
    this.startContainer = text;
    this.startOffset = 0;
    this.endContainer = text;
    this.endOffset = (text.textContent || "").length;
  }
  setEnd(node, offset) {
    this.endContainer = node;
    this.endOffset = offset;
  }
  toString() {
    const text = this.startContainer?.textContent || "";
    return text.slice(this.startOffset, this.endOffset);
  }
  getBoundingClientRect() { return { left: 20, top: 40, width: 80, height: 16 }; }
}

class MiniSelection {
  constructor() { this.range = null; }
  get rangeCount() { return this.range ? 1 : 0; }
  get isCollapsed() {
    if (!this.range) return true;
    return this.range.startContainer === this.range.endContainer && this.range.startOffset === this.range.endOffset;
  }
  getRangeAt() { return this.range; }
  removeAllRanges() { this.range = null; }
}

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitUntil(check, label, ms = 1000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const value = check();
    if (value) return value;
    await wait(10);
  }
  throw new Error(label);
}

test("invite comment save keeps the original selection after dialog focus", async () => {
  const html = fs.readFileSync(path.join(rootDir, "invite.html"), "utf8");
  const source = {
    schemaVersion: 1,
    type: "review_ready_chapter",
    bookId: "demo-book",
    chapterId: "chapter_0001",
    chapterNumber: 1,
    chapterVersion: 1,
    status: "REVIEW_READY",
    title: "One",
    exportedAt: "2026-08-28T10:00:00.000Z",
    packageFingerprint: "a".repeat(64),
    content: [{ id: "p001", text: "Example paragraph." }]
  };
  const posts = [];
  const document = new MiniDocument(html);
  const selection = new MiniSelection();
  const local = new Map();
  async function mockFetch(url, options = {}) {
    if (url === "/api/public/invites/tok") {
      return { ok: true, json: async () => ({ inviteId: "tok", title: source.title, chapterNumber: 1, chapterVersion: 1, packageFingerprint: source.packageFingerprint, packageUrl: "/pkg.json", bookId: source.bookId, chapterId: source.chapterId }) };
    }
    if (url === "/pkg.json") return { ok: true, json: async () => source };
    if (url === "/api/public/invites/tok/join") {
      return { ok: true, json: async () => ({ inviteId: "tok", reviewerId: "r1", displayName: "Anna", sessionToken: "session-1", packageFingerprint: source.packageFingerprint, bookId: source.bookId, chapterId: source.chapterId, chapterVersion: 1 }) };
    }
    if (url === "/api/reader/comments" && (options.method || "GET") === "POST") {
      posts.push({ url, options });
      const body = JSON.parse(options.body);
      return { ok: true, json: async () => ({ commentId: "c1", ...body, reviewerDisplayName: "Anna" }) };
    }
    throw new Error(`unexpected fetch ${url}`);
  }
  const context = {
    console,
    setTimeout,
    clearTimeout,
    URLSearchParams,
    JSON,
    Date,
    Error,
    Promise,
    TextEncoder,
    Uint8Array,
    crypto: webcrypto,
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    matchMedia: () => ({ matches: true }),
    innerWidth: 1024,
    innerHeight: 768,
    location: { search: "?token=tok" },
    localStorage: {
      getItem: (key) => (local.has(key) ? local.get(key) : null),
      setItem: (key, value) => local.set(key, String(value)),
      removeItem: (key) => local.delete(key)
    },
    document,
    fetch: mockFetch,
    getSelection: () => selection
  };
  context.window = context;
  context.globalThis = context;
  context.addEventListener = (type, fn, options) => document.addEventListener(type, fn, options);
  document.defaultView = context;
  vm.createContext(context);
  for (const file of ["selection-logic.js", "review-api.js", "reader-feedback-api.js", "invite.js"]) {
    vm.runInContext(fs.readFileSync(path.join(rootDir, file), "utf8"), context, { filename: file });
  }

  await waitUntil(() => document.querySelector("#invite-gate") && document.querySelector("#invite-gate").hidden === false, "invite gate did not open");
  document.querySelector("#display-name").value = "Anna";
  document.querySelector("#start-invite").dispatchEvent(new MiniEvent("click", { bubbles: true }));
  const paragraph = await waitUntil(() => document.querySelector("#paragraph-p001"), "chapter paragraph did not render");

  const range = new MiniRange();
  range.startContainer = paragraph.childNodes[0];
  range.startOffset = 0;
  range.endContainer = paragraph.childNodes[0];
  range.endOffset = 7;
  selection.range = range;
  paragraph.dispatchEvent(new MiniEvent("pointerup", { bubbles: true }));
  await wait(80);
  assert.equal(document.querySelector("#selection-actions").hidden, false);
  assert.equal(document.querySelector("#selection-preview").textContent, "Example");

  const commentButton = document.querySelector('[data-selection-action="comment"]');
  commentButton.dispatchEvent(new MiniEvent("click", { bubbles: true }));
  assert.equal(document.querySelector("#annotation-dialog").open, true);

  document.querySelector("#annotation-comment").focus();
  await wait(360);

  document.querySelector("#annotation-comment").value = "Felt abrupt.";
  document.querySelector("#annotation-form").dispatchEvent(new MiniEvent("submit", { bubbles: true, cancelable: true }));
  await waitUntil(() => posts.length === 1, "comment POST was not sent");

  assert.equal(posts[0].url, "/api/reader/comments");
  assert.equal(posts[0].options.method, "POST");
  const body = JSON.parse(posts[0].options.body);
  assert.equal(body.paragraphId, "p001");
  assert.equal(body.selectionStart, 0);
  assert.equal(body.selectionEnd, 7);
  assert.equal(body.selectedText, "Example");
  assert.equal(body.commentText, "Felt abrupt.");
  assert.equal(body.packageFingerprint, source.packageFingerprint);
});
