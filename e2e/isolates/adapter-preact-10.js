// packages/protocol/src/grants.ts
/** Topics under this prefix belong to the kernel (ADR 0002). */
var SYSTEM_TOPIC_PREFIX = "isoloop.";
function isSystemTopic(topic) {
	return topic.startsWith(SYSTEM_TOPIC_PREFIX);
}
// packages/protocol/src/system-topics.ts
/** Wraps a hand-written check as a Standard Schema that passes valid values through unchanged. */
function systemSchema(check) {
	return { "~standard": {
		version: 1,
		vendor: "isoloop",
		validate: (value) => {
			const issues = check(value, []);
			return issues.length === 0 ? { value } : { issues };
		}
	} };
}
/** Defines a system topic. The name must start with `isoloop.`. */
function systemTopic(name, def) {
	if (!isSystemTopic(name)) throw new Error(`system topic names start with isoloop.: ${name}`);
	return Object.freeze({
		...def,
		name
	});
}
var isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var issue = (path, message) => [{
	message,
	path
}];
/** Small building blocks for hand-written checks. */
var checks = {
	string: (v, path) => typeof v === "string" ? [] : issue(path, "expected a string"),
	optionalString: (v, path) => v === void 0 || typeof v === "string" ? [] : issue(path, "expected a string or nothing"),
	object: (fields) => (v, path) => {
		if (!isObject(v)) return issue(path, "expected an object");
		return Object.entries(fields).flatMap(([k, check]) => check(v[k], [...path, k]));
	},
	any: () => []
};
// packages/protocol/src/route.ts
var stringOrNull = (v, path) => v === null || typeof v === "string" ? [] : [{
	message: "expected a string or null",
	path
}];
/**
* `isoloop.route.v1`: compacted, key `"current"`, memory only (the URL is the
* source of truth). Only the kernel publishes it; every isolate may
* subscribe without a grant, with `from: 'earliest'` to get the current
* route at once.
*/
var routeTopic = systemTopic("isoloop.route.v1", {
	schema: systemSchema(checks.object({
		href: checks.string,
		pathname: checks.string,
		path: stringOrNull,
		search: checks.string,
		hash: checks.string,
		state: checks.any
	})),
	retention: { kind: "compacted" }
});
// packages/protocol/src/version.ts
/** `"0.4.2"` → `"0.4"`. Anything that isn't `major.minor[.patch…]` gives `undefined`. */
function majorMinor(version) {
	const m = /^(\d+)\.(\d+)(?:[.+-].*)?$/.exec(version);
	return m ? `${Number(m[1])}.${Number(m[2])}` : void 0;
}
// packages/runtime/src/vanilla.ts
/** This build's stamp: `major.minor` of the package version, inlined when tsdown bundles it. */
var REQUIRES = majorMinor("0.0.0") ?? "0.0";
// node_modules/.pnpm/preact@10.29.8/node_modules/preact/dist/preact.module.js
var n;
var l$1;
var u$2;
var i$2;
var r$1;
var o$1;
var e$1;
var f$2;
var c$1;
var a$1;
var s$1;
var h;
var p$1;
var v$1;
var y$1;
var d$1 = {};
var w$1 = [];
var _$1 = /acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i;
var g = Array.isArray;
function m$1(n, l) {
	for (var u in l) n[u] = l[u];
	return n;
}
function b(n) {
	n && n.parentNode && n.parentNode.removeChild(n);
}
function k$1(l, u, t) {
	var i, r, o, e = {};
	for (o in u) "key" == o ? i = u[o] : "ref" == o ? r = u[o] : e[o] = u[o];
	if (arguments.length > 2 && (e.children = arguments.length > 3 ? n.call(arguments, 2) : t), "function" == typeof l && null != l.defaultProps) for (o in l.defaultProps) void 0 === e[o] && (e[o] = l.defaultProps[o]);
	return x$1(l, e, i, r, null);
}
function x$1(n, t, i, r, o) {
	var e = {
		type: n,
		props: t,
		key: i,
		ref: r,
		__k: null,
		__: null,
		__b: 0,
		__e: null,
		__c: null,
		constructor: void 0,
		__v: null == o ? ++u$2 : o,
		__i: -1,
		__u: 0
	};
	return null == o && null != l$1.vnode && l$1.vnode(e), e;
}
function S(n) {
	return n.children;
}
function C$1(n, l) {
	this.props = n, this.context = l;
}
function $(n, l) {
	if (null == l) return n.__ ? $(n.__, n.__i + 1) : null;
	for (var u; l < n.__k.length; l++) if (null != (u = n.__k[l]) && null != u.__e) return u.__e;
	return "function" == typeof n.type ? $(n) : null;
}
function I(n) {
	if (n.__P && n.__d) {
		var u = n.__v, t = u.__e, i = [], r = [], o = m$1({}, u);
		o.__v = u.__v + 1, l$1.vnode && l$1.vnode(o), q$1(n.__P, o, u, n.__n, n.__P.namespaceURI, 32 & u.__u ? [t] : null, i, null == t ? $(u) : t, !!(32 & u.__u), r), o.__v = u.__v, o.__.__k[o.__i] = o, D$1(i, o, r), u.__e = u.__ = null, o.__e != t && P(o);
	}
}
function P(n) {
	if (null != (n = n.__) && null != n.__c) return n.__e = n.__c.base = null, n.__k.some(function(l) {
		if (null != l && null != l.__e) return n.__e = n.__c.base = l.__e;
	}), P(n);
}
function A(n) {
	(!n.__d && (n.__d = !0) && i$2.push(n) && !H.__r++ || r$1 != l$1.debounceRendering) && ((r$1 = l$1.debounceRendering) || o$1)(H);
}
function H() {
	try {
		for (var n, l = 1; i$2.length;) i$2.length > l && i$2.sort(e$1), n = i$2.shift(), l = i$2.length, I(n);
	} finally {
		i$2.length = H.__r = 0;
	}
}
function L(n, l, u, t, i, r, o, e, f, c, a) {
	var s, h, p, v, y, _, g = t && t.__k || w$1, m = l.length;
	for (f = T$1(u, l, g, f, m), s = 0; s < m; s++) null != (p = u.__k[s]) && (h = -1 != p.__i && g[p.__i] || d$1, p.__i = s, _ = q$1(n, p, h, i, r, o, e, f, c, a), v = p.__e, p.ref && h.ref != p.ref && (h.ref && J(h.ref, null, p), a.push(p.ref, p.__c || v, p)), null == y && null != v && (y = v), 4 & p.__u ? (f = j$1(p, f, n), h.__e && (h.__e = null)) : "function" == typeof p.type && void 0 !== _ ? f = _ : v && (f = v.nextSibling), p.__u &= -7);
	return u.__e = y, f;
}
function T$1(n, l, u, t, i) {
	var r, o, e, f, c, a = u.length, s = a, h = 0;
	for (n.__k = new Array(i), r = 0; r < i; r++) null != (o = l[r]) && "boolean" != typeof o && "function" != typeof o ? ("string" == typeof o || "number" == typeof o || "bigint" == typeof o || o.constructor == String ? o = n.__k[r] = x$1(null, o, null, null, null) : g(o) ? o = n.__k[r] = x$1(S, { children: o }, null, null, null) : void 0 === o.constructor && o.__b > 0 ? o = n.__k[r] = x$1(o.type, o.props, o.key, o.ref ? o.ref : null, o.__v) : n.__k[r] = o, f = r + h, o.__ = n, o.__b = n.__b + 1, e = null, -1 != (c = o.__i = O(o, u, f, s)) && (s--, (e = u[c]) && (e.__u |= 2)), null == e || null == e.__v ? (-1 == c && (i > a ? h-- : i < a && h++), "function" != typeof o.type && (o.__u |= 4)) : c != f && (c == f - 1 ? h-- : c == f + 1 ? h++ : (c > f ? h-- : h++, o.__u |= 4))) : n.__k[r] = null;
	if (s) for (r = 0; r < a; r++) null != (e = u[r]) && 0 == (2 & e.__u) && (e.__e == t && (t = $(e)), K(e, e));
	return t;
}
function j$1(n, l, u) {
	var t, i;
	if ("function" == typeof n.type) {
		for (t = n.__k, i = 0; t && i < t.length; i++) t[i] && (t[i].__ = n, l = j$1(t[i], l, u));
		return l;
	}
	n.__e != l && (l && n.type && !l.parentNode && (l = $(n)), l = u.insertBefore(n.__e, l || null));
	do
		l = l && l.nextSibling;
	while (null != l && 8 == l.nodeType);
	return l;
}
function O(n, l, u, t) {
	var i, r, o, e = n.key, f = n.type, c = l[u], a = null != c && 0 == (2 & c.__u);
	if (null === c && null == e || a && e == c.key && f == c.type) return u;
	if (t > (a ? 1 : 0)) {
		for (i = u - 1, r = u + 1; i >= 0 || r < l.length;) if (null != (c = l[o = i >= 0 ? i-- : r++]) && 0 == (2 & c.__u) && e == c.key && f == c.type) return o;
	}
	return -1;
}
function z$1(n, l, u) {
	"-" == l[0] ? n.setProperty(l, null == u ? "" : u) : n[l] = null == u ? "" : "number" != typeof u || _$1.test(l) ? u : u + "px";
}
function N(n, l, u, t, i) {
	var r, o;
	n: if ("style" == l) if ("string" == typeof u) n.style.cssText = u;
	else {
		if ("string" == typeof t && (n.style.cssText = t = ""), t) for (l in t) u && l in u || z$1(n.style, l, "");
		if (u) for (l in u) t && u[l] == t[l] || z$1(n.style, l, u[l]);
	}
	else if ("o" == l[0] && "n" == l[1]) r = l != (l = l.replace(s$1, "$1")), o = l.toLowerCase(), l = o in n || "onFocusOut" == l || "onFocusIn" == l ? o.slice(2) : l.slice(2), n.l || (n.l = {}), n.l[l + r] = u, u ? t ? u[a$1] = t[a$1] : (u[a$1] = h, n.addEventListener(l, r ? v$1 : p$1, r)) : n.removeEventListener(l, r ? v$1 : p$1, r);
	else {
		if ("http://www.w3.org/2000/svg" == i) l = l.replace(/xlink(H|:h)/, "h").replace(/sName$/, "s");
		else if ("width" != l && "height" != l && "href" != l && "list" != l && "form" != l && "tabIndex" != l && "download" != l && "rowSpan" != l && "colSpan" != l && "role" != l && "popover" != l && l in n) try {
			n[l] = null == u ? "" : u;
			break n;
		} catch (n) {}
		"function" == typeof u || (null == u || !1 === u && "-" != l[4] ? n.removeAttribute(l) : n.setAttribute(l, "popover" == l && 1 == u ? "" : u));
	}
}
function V(n) {
	return function(u) {
		if (this.l) {
			var t = this.l[u.type + n];
			if (null == u[c$1]) u[c$1] = h++;
			else if (u[c$1] < t[a$1]) return;
			return t(l$1.event ? l$1.event(u) : u);
		}
	};
}
function q$1(n, u, t, i, r, o, e, f, c, a) {
	var s, h, p, v, y, d, _, k, x, M, I, P, A, H, T, j, F = u.type;
	if (void 0 !== u.constructor) return null;
	128 & t.__u && (c = !!(32 & t.__u), o = [f = u.__e = t.__e]), (s = l$1.__b) && s(u);
	n: if ("function" == typeof F) {
		h = e.length;
		try {
			if (x = u.props, M = F.prototype && F.prototype.render, I = (s = F.contextType) && i[s.__c], P = s ? I ? I.props.value : s.__ : i, t.__c ? k = (p = u.__c = t.__c).__ = p.__E : (M ? u.__c = p = new F(x, P) : (u.__c = p = new C$1(x, P), p.constructor = F, p.render = Q), I && I.sub(p), p.state || (p.state = {}), p.__n = i, v = p.__d = !0, p.__h = [], p._sb = []), M && null == p.__s && (p.__s = p.state), M && null != F.getDerivedStateFromProps && (p.__s == p.state && (p.__s = m$1({}, p.__s)), m$1(p.__s, F.getDerivedStateFromProps(x, p.__s))), y = p.props, d = p.state, p.__v = u, v) M && null == F.getDerivedStateFromProps && null != p.componentWillMount && p.componentWillMount(), M && null != p.componentDidMount && p.__h.push(p.componentDidMount);
			else {
				if (M && null == F.getDerivedStateFromProps && x !== y && null != p.componentWillReceiveProps && p.componentWillReceiveProps(x, P), u.__v == t.__v || !p.__e && null != p.shouldComponentUpdate && !1 === p.shouldComponentUpdate(x, p.__s, P)) {
					u.__v != t.__v && (p.props = x, p.state = p.__s, p.__d = !1), u.__e = t.__e, u.__k = t.__k, u.__k.some(function(n) {
						n && (n.__ = u);
					}), w$1.push.apply(p.__h, p._sb), p._sb = [], p.__h.length && e.push(p), f = $(t);
					break n;
				}
				null != p.componentWillUpdate && p.componentWillUpdate(x, p.__s, P), M && null != p.componentDidUpdate && p.__h.push(function() {
					p.componentDidUpdate(y, d, _);
				});
			}
			if (p.context = P, p.props = x, p.__P = n, p.__e = !1, A = l$1.__r, H = 0, M) p.state = p.__s, p.__d = !1, A && A(u), s = p.render(p.props, p.state, p.context), w$1.push.apply(p.__h, p._sb), p._sb = [];
			else do
				p.__d = !1, A && A(u), s = p.render(p.props, p.state, p.context), p.state = p.__s;
			while (p.__d && ++H < 25);
			p.state = p.__s, null != p.getChildContext && (i = m$1(m$1({}, i), p.getChildContext())), M && !v && null != p.getSnapshotBeforeUpdate && (_ = p.getSnapshotBeforeUpdate(y, d)), T = null != s && s.type === S && null == s.key ? E(s.props.children) : s, f = L(n, g(T) ? T : [T], u, t, i, r, o, e, f, c, a), p.base = u.__e, u.__u &= -161, p.__h.length && e.push(p), k && (p.__E = p.__ = null);
		} catch (n) {
			if (e.length = h, u.__v = null, c || null != o) {
				if (n.then) {
					for (u.__u |= c ? 160 : 128; f && 8 == f.nodeType && f.nextSibling;) f = f.nextSibling;
					null != o && (o[o.indexOf(f)] = null), u.__e = f;
				} else if (null != o) for (j = o.length; j--;) b(o[j]);
			} else u.__e = t.__e;
			u.__k ??= t.__k || [], n.then || B$1(u), l$1.__e(n, u, t);
		}
	} else null == o && u.__v == t.__v ? (u.__k = t.__k, u.__e = t.__e) : f = u.__e = G(t.__e, u, t, i, r, o, e, c, a);
	return (s = l$1.diffed) && s(u), 128 & u.__u ? void 0 : f;
}
function B$1(n) {
	n && (n.__c && (n.__c.__e = !0), n.__k && n.__k.some(B$1));
}
function D$1(n, u, t) {
	for (var i = 0; i < t.length; i++) J(t[i], t[++i], t[++i]);
	l$1.__c && l$1.__c(u, n), n.some(function(u) {
		try {
			n = u.__h, u.__h = [], n.some(function(n) {
				n.call(u);
			});
		} catch (n) {
			l$1.__e(n, u.__v);
		}
	});
}
function E(n) {
	return "object" != typeof n || null == n || n.__b > 0 ? n : g(n) ? n.map(E) : void 0 !== n.constructor ? null : m$1({}, n);
}
function G(u, t, i, r, o, e, f, c, a) {
	var s, h, p, v, y, w, _, m = i.props || d$1, k = t.props, x = t.type;
	if ("svg" == x ? o = "http://www.w3.org/2000/svg" : "math" == x ? o = "http://www.w3.org/1998/Math/MathML" : o || (o = "http://www.w3.org/1999/xhtml"), null != e) {
		for (s = 0; s < e.length; s++) if ((y = e[s]) && "setAttribute" in y == !!x && (x ? y.localName == x : 3 == y.nodeType)) {
			u = y, e[s] = null;
			break;
		}
	}
	if (null == u) {
		if (null == x) return document.createTextNode(k);
		u = document.createElementNS(o, x, k.is && k), c && (l$1.__m && l$1.__m(t, e), c = !1), e = null;
	}
	if (null == x) m === k || c && u.data == k || (u.data = k);
	else {
		if (e = "textarea" == x && null != k.defaultValue ? null : e && n.call(u.childNodes), !c && null != e) for (m = {}, s = 0; s < u.attributes.length; s++) m[(y = u.attributes[s]).name] = y.value;
		for (s in m) y = m[s], "dangerouslySetInnerHTML" == s ? p = y : "children" == s || s in k || "value" == s && "defaultValue" in k || "checked" == s && "defaultChecked" in k || N(u, s, null, y, o);
		for (s in k) y = k[s], "children" == s ? v = y : "dangerouslySetInnerHTML" == s ? h = y : "value" == s ? w = y : "checked" == s ? _ = y : c && "function" != typeof y || m[s] === y || N(u, s, y, m[s], o);
		if (h) c || p && (h.__html == p.__html || h.__html == u.innerHTML) || (u.innerHTML = h.__html), t.__k = [];
		else if (p && (u.innerHTML = ""), L("template" == t.type ? u.content : u, g(v) ? v : [v], t, i, r, "foreignObject" == x ? "http://www.w3.org/1999/xhtml" : o, e, f, e ? e[0] : i.__k && $(i, 0), c, a), null != e) for (s = e.length; s--;) b(e[s]);
		c && "textarea" != x || (s = "value", "progress" == x && null == w ? u.removeAttribute("value") : null != w && (w !== u[s] || "progress" == x && !w || "option" == x && w != m[s]) && N(u, s, w, m[s], o), s = "checked", null != _ && _ != u[s] && N(u, s, _, m[s], o));
	}
	return u;
}
function J(n, u, t) {
	try {
		if ("function" == typeof n) {
			var i = "function" == typeof n.__u;
			i && n.__u(), i && null == u || (n.__u = n(u));
		} else n.current = u;
	} catch (n) {
		l$1.__e(n, t);
	}
}
function K(n, u, t) {
	var i, r;
	if (l$1.unmount && l$1.unmount(n), (i = n.ref) && (i.current && i.current != n.__e || J(i, null, u)), null != (i = n.__c)) {
		if (i.componentWillUnmount) try {
			i.componentWillUnmount();
		} catch (n) {
			l$1.__e(n, u);
		}
		i.base = i.__P = i.__n = null;
	}
	if (i = n.__k) for (r = 0; r < i.length; r++) i[r] && K(i[r], u, t || "function" != typeof n.type);
	t || b(n.__e), n.__c = n.__ = n.__e = void 0;
}
function Q(n, l, u) {
	return this.constructor(n, u);
}
function R(u, t, i) {
	var r, o, e, f;
	t == document && (t = document.documentElement), l$1.__ && l$1.__(u, t), o = (r = "function" == typeof i) ? null : i && i.__k || t.__k, e = [], f = [], q$1(t, u = (!r && i || t).__k = k$1(S, null, [u]), o || d$1, d$1, t.namespaceURI, !r && i ? [i] : o ? null : t.firstChild ? n.call(t.childNodes) : null, e, !r && i ? i : o ? o.__e : t.firstChild, r, f), D$1(e, u, f), u.props.children = null;
}
function X(n) {
	function l(n) {
		var u, t;
		return this.getChildContext || (u = /* @__PURE__ */ new Set(), (t = {})[l.__c] = this, this.getChildContext = function() {
			return t;
		}, this.componentWillUnmount = function() {
			u = null;
		}, this.shouldComponentUpdate = function(n) {
			this.props.value != n.value && u.forEach(function(n) {
				n.__e = !0, A(n);
			});
		}, this.sub = function(n) {
			u.add(n);
			var l = n.componentWillUnmount;
			n.componentWillUnmount = function() {
				u && u.delete(n), l && l.call(n);
			};
		}), n.children;
	}
	return l.__c = "__cC" + y$1++, l.__ = n, l.Provider = l.__l = (l.Consumer = function(n, l) {
		return n.children(l);
	}).contextType = l, l;
}
n = w$1.slice, l$1 = { __e: function(n, l, u, t) {
	for (var i, r, o; l = l.__;) if ((i = l.__c) && !i.__) try {
		if ((r = i.constructor) && null != r.getDerivedStateFromError && (i.setState(r.getDerivedStateFromError(n)), o = i.__d), null != i.componentDidCatch && (i.componentDidCatch(n, t || {}), o = i.__d), o) return i.__E = i;
	} catch (l) {
		n = l;
	}
	throw n;
} }, u$2 = 0, C$1.prototype.setState = function(n, l) {
	var u = null != this.__s && this.__s != this.state ? this.__s : this.__s = m$1({}, this.state);
	"function" == typeof n && (n = n(m$1({}, u), this.props)), n && m$1(u, n), null != n && this.__v && (l && this._sb.push(l), A(this));
}, C$1.prototype.forceUpdate = function(n) {
	this.__v && (this.__e = !0, n && this.__h.push(n), A(this));
}, C$1.prototype.render = S, i$2 = [], o$1 = "function" == typeof Promise ? Promise.prototype.then.bind(Promise.resolve()) : setTimeout, e$1 = function(n, l) {
	return n.__v.__b - l.__v.__b;
}, H.__r = 0, f$2 = Math.random().toString(8), c$1 = "__d" + f$2, a$1 = "__a" + f$2, s$1 = /(PointerCapture)$|Capture$/i, h = 0, p$1 = V(!1), v$1 = V(!0), y$1 = 0;
// node_modules/.pnpm/preact@10.29.8/node_modules/preact/hooks/dist/hooks.module.js
var t;
var r;
var u$1;
var i$1;
var o = 0;
var f$1 = [];
var c = l$1;
var e = c.__b;
var a = c.__r;
var v = c.diffed;
var l = c.__c;
var m = c.unmount;
var p = c.__;
function s(n, t) {
	c.__h && c.__h(r, n, o || t), o = 0;
	var u = r.__H || (r.__H = {
		__: [],
		__h: []
	});
	return n >= u.__.length && u.__.push({}), u.__[n];
}
function d(n) {
	return o = 1, y(D, n);
}
function y(n, u, i) {
	var o = s(t++, 2);
	if (o.t = n, !o.__c && (o.__ = [i ? i(u) : D(void 0, u), function(n) {
		var t = o.__N ? o.__N[0] : o.__[0], r = o.t(t, n);
		t !== r && (o.__N = [r, o.__[1]], o.__c.setState({}));
	}], o.__c = r, !r.__f)) {
		var f = function(n, t, r) {
			if (!o.__c.__H) return !0;
			var u = !1, i = o.__c.props !== n;
			if (o.__c.__H.__.some(function(n) {
				if (n.__N) {
					u = !0;
					var t = n.__[0];
					n.__ = n.__N, n.__N = void 0, t !== n.__[0] && (i = !0);
				}
			}), c) {
				var f = c.call(this, n, t, r);
				return u ? f || i : f;
			}
			return !u || i;
		};
		r.__f = !0;
		var c = r.shouldComponentUpdate, e = r.componentWillUpdate;
		r.componentWillUpdate = function(n, t, r) {
			if (this.__e) {
				var u = c;
				c = void 0, f(n, t, r), c = u;
			}
			e && e.call(this, n, t, r);
		}, r.shouldComponentUpdate = f;
	}
	return o.__N || o.__;
}
function _(n, u) {
	var i = s(t++, 4);
	!c.__s && C(i.__H, u) && (i.__ = n, i.u = u, r.__h.push(i));
}
function T(n, r) {
	var u = s(t++, 7);
	return C(u.__H, r) && (u.__ = n(), u.__H = r, u.__h = n), u.__;
}
function q(n, t) {
	return o = 8, T(function() {
		return n;
	}, t);
}
function x(n) {
	var u = r.context[n.__c], i = s(t++, 9);
	return i.c = n, u ? (i.__ ?? (i.__ = !0, u.sub(r)), u.props.value) : n.__;
}
function j() {
	for (var n; n = f$1.shift();) {
		var t = n.__H;
		if (n.__P && t) try {
			t.__h.some(z), t.__h.some(B), t.__h = [];
		} catch (r) {
			t.__h = [], c.__e(r, n.__v);
		}
	}
}
c.__b = function(n) {
	r = null, e && e(n);
}, c.__ = function(n, t) {
	n && t.__k && t.__k.__m && (n.__m = t.__k.__m), p && p(n, t);
}, c.__r = function(n) {
	a && a(n), t = 0;
	var i = (r = n.__c).__H;
	i && (u$1 === r ? (i.__h = [], r.__h = [], i.__.some(function(n) {
		n.__N && (n.__ = n.__N), n.u = n.__N = void 0;
	})) : (i.__h.some(z), i.__h.some(B), i.__h = [], t = 0)), u$1 = r;
}, c.diffed = function(n) {
	v && v(n);
	var t = n.__c;
	t && t.__H && (t.__H.__h.length && (1 !== f$1.push(t) && i$1 === c.requestAnimationFrame || ((i$1 = c.requestAnimationFrame) || w)(j)), t.__H.__.some(function(n) {
		n.u && (n.__H = n.u, n.u = void 0);
	})), u$1 = r = null;
}, c.__c = function(n, t) {
	t.some(function(n) {
		try {
			n.__h.some(z), n.__h = n.__h.filter(function(n) {
				return !n.__ || B(n);
			});
		} catch (r) {
			t.some(function(n) {
				n.__h && (n.__h = []);
			}), t = [], c.__e(r, n.__v);
		}
	}), l && l(n, t);
}, c.unmount = function(n) {
	m && m(n);
	var t, r = n.__c;
	r && r.__H && (r.__H.__.some(function(n) {
		try {
			z(n);
		} catch (n) {
			t = n;
		}
	}), r.__H = void 0, t && c.__e(t, r.__v));
};
var k = "function" == typeof requestAnimationFrame;
function w(n) {
	var t, r = function() {
		clearTimeout(u), k && cancelAnimationFrame(t), setTimeout(n);
	}, u = setTimeout(r, 35);
	k && (t = requestAnimationFrame(r));
}
function z(n) {
	var t = r, u = n.__c;
	"function" == typeof u && (n.__c = void 0, u()), r = t;
}
function B(n) {
	var t = r;
	n.__c = n.__(), r = t;
}
function C(n, t) {
	return !n || n.length !== t.length || t.some(function(t, r) {
		return t !== n[r];
	});
}
function D(n, t) {
	return "function" == typeof t ? t(n) : t;
}
// packages/preact/src/context.ts
var IsolateCtx = X(null);
/** The isolate context. Throws outside a component that `defineIsolate` rendered. */
function useIsolate() {
	const ctx = x(IsolateCtx);
	if (!ctx) throw new Error("useIsolate: not inside a component rendered by defineIsolate()");
	return ctx;
}
// packages/preact/src/define.ts
function defineIsolate(Component) {
	return {
		requires: REQUIRES,
		start(ctx) {
			const container = ctx.root;
			if (!(container instanceof Element)) throw new Error(`defineIsolate (Preact): "${ctx.id}" is headless; Preact needs a surface`);
			R(k$1(IsolateCtx.Provider, { value: ctx }, k$1(Component, { config: ctx.config })), container);
			ctx.onShutdown(() => {
				R(null, container);
			});
		}
	};
}
// packages/preact/src/hooks/topic.ts
/**
* The latest value on `topic`, or `undefined` until one arrives. A bus
* restart that lost the memory topic (`onReset`, ADR 0007) clears it.
* Subscribes on mount and unsubscribes on unmount; changing `topic` or
* `from` resubscribes.
*/
function useTopic(topic, opts = {}) {
	const { bus } = useIsolate();
	const [value, setValue] = d(void 0);
	const from = opts.from ?? "latest";
	_(() => {
		setValue(void 0);
		return bus.subscribe(topic, (r) => setValue({ v: r.value }), {
			from,
			onReset: () => setValue(void 0)
		});
	}, [
		bus,
		topic.name,
		from
	]);
	return value?.v;
}
/** A function that publishes to `topic`; it resolves once the broker appended the record (`BusClient.publish`). */
function usePublish(topic) {
	const { bus } = useIsolate();
	return q((value, o = {}) => bus.publish(topic, o.key === void 0 ? { value } : {
		key: o.key,
		value
	}), [bus, topic.name]);
}
// packages/preact/src/hooks/host.ts
/** `measure`, `focus`, `scrollIntoView` and `navigate`, as `ctx.host` has them. */
function useHost() {
	return useIsolate().host;
}
// packages/preact/src/hooks/route.ts
/** The current route, or `undefined` until the first record arrives (or with routing off). */
function useRoute() {
	return useTopic(routeTopic, { from: "earliest" });
}
var package_default = {
	name: "preact",
	amdName: "preact",
	version: "10.29.8",
	"private": false,
	publishConfig: {
		"access": "public",
		"provenance": true
	},
	description: "Fast 3kb React-compatible Virtual DOM library.",
	main: "dist/preact.js",
	module: "dist/preact.module.js",
	"umd:main": "dist/preact.umd.js",
	unpkg: "dist/preact.min.js",
	source: "src/index.js",
	typesVersions: { "<=5.0": { ".": ["./src/index-5.d.ts"] } },
	exports: {
		".": {
			"types@<=5.0": { "types": "./src/index-5.d.ts" },
			"types": "./src/index.d.ts",
			"browser": "./dist/preact.module.js",
			"umd": "./dist/preact.umd.js",
			"import": "./dist/preact.mjs",
			"require": "./dist/preact.js"
		},
		"./compat": {
			"types": "./compat/src/index.d.ts",
			"browser": "./compat/dist/compat.module.js",
			"umd": "./compat/dist/compat.umd.js",
			"import": "./compat/dist/compat.mjs",
			"require": "./compat/dist/compat.js"
		},
		"./debug": {
			"types": "./debug/src/index.d.ts",
			"browser": "./debug/dist/debug.module.js",
			"umd": "./debug/dist/debug.umd.js",
			"import": "./debug/dist/debug.mjs",
			"require": "./debug/dist/debug.js"
		},
		"./devtools": {
			"types": "./devtools/src/index.d.ts",
			"browser": "./devtools/dist/devtools.module.js",
			"umd": "./devtools/dist/devtools.umd.js",
			"import": "./devtools/dist/devtools.mjs",
			"require": "./devtools/dist/devtools.js"
		},
		"./hooks": {
			"types": "./hooks/src/index.d.ts",
			"browser": "./hooks/dist/hooks.module.js",
			"umd": "./hooks/dist/hooks.umd.js",
			"import": "./hooks/dist/hooks.mjs",
			"require": "./hooks/dist/hooks.js"
		},
		"./test-utils": {
			"types": "./test-utils/src/index.d.ts",
			"browser": "./test-utils/dist/testUtils.module.js",
			"umd": "./test-utils/dist/testUtils.umd.js",
			"import": "./test-utils/dist/testUtils.mjs",
			"require": "./test-utils/dist/testUtils.js"
		},
		"./compat/test-utils": {
			"types": "./test-utils/src/index.d.ts",
			"browser": "./test-utils/dist/testUtils.module.js",
			"umd": "./test-utils/dist/testUtils.umd.js",
			"import": "./test-utils/dist/testUtils.mjs",
			"require": "./test-utils/dist/testUtils.js"
		},
		"./jsx-runtime": {
			"types": "./jsx-runtime/src/index.d.ts",
			"browser": "./jsx-runtime/dist/jsxRuntime.module.js",
			"umd": "./jsx-runtime/dist/jsxRuntime.umd.js",
			"import": "./jsx-runtime/dist/jsxRuntime.mjs",
			"require": "./jsx-runtime/dist/jsxRuntime.js"
		},
		"./jsx-dev-runtime": {
			"types": "./jsx-runtime/src/index.d.ts",
			"browser": "./jsx-runtime/dist/jsxRuntime.module.js",
			"umd": "./jsx-runtime/dist/jsxRuntime.umd.js",
			"import": "./jsx-runtime/dist/jsxRuntime.mjs",
			"require": "./jsx-runtime/dist/jsxRuntime.js"
		},
		"./compat/client": {
			"types": "./compat/client.d.ts",
			"import": "./compat/client.mjs",
			"require": "./compat/client.js"
		},
		"./compat/server": {
			"browser": "./compat/server.browser.js",
			"import": "./compat/server.mjs",
			"require": "./compat/server.js"
		},
		"./compat/server.browser": {
			"types": "./compat/server.d.ts",
			"default": "./compat/server.browser.js"
		},
		"./compat/jsx-runtime": {
			"types": "./jsx-runtime/src/index.d.ts",
			"import": "./compat/jsx-runtime.mjs",
			"require": "./compat/jsx-runtime.js"
		},
		"./compat/jsx-dev-runtime": {
			"types": "./jsx-runtime/src/index.d.ts",
			"import": "./compat/jsx-dev-runtime.mjs",
			"require": "./compat/jsx-dev-runtime.js"
		},
		"./compat/scheduler": {
			"import": "./compat/scheduler.mjs",
			"require": "./compat/scheduler.js"
		},
		"./package.json": "./package.json",
		"./compat/package.json": "./compat/package.json",
		"./debug/package.json": "./debug/package.json",
		"./devtools/package.json": "./devtools/package.json",
		"./hooks/package.json": "./hooks/package.json",
		"./test-utils/package.json": "./test-utils/package.json",
		"./jsx-runtime/package.json": "./jsx-runtime/package.json"
	},
	license: "MIT",
	funding: {
		"type": "opencollective",
		"url": "https://opencollective.com/preact"
	},
	types: "src/index.d.ts",
	scripts: {
		"prepare": "husky && npm run test:install && run-s build",
		"build": "npm-run-all --parallel 'build:*'",
		"build:core": "microbundle build --raw --no-generateTypes -f cjs,esm,umd",
		"build:core-min": "microbundle build --raw --no-generateTypes -f cjs,esm,umd,iife src/cjs.js -o dist/preact.min.js",
		"build:debug": "microbundle build --raw --no-generateTypes -f cjs,esm,umd --cwd debug",
		"build:devtools": "microbundle build --raw --no-generateTypes -f cjs,esm,umd --cwd devtools",
		"build:hooks": "microbundle build --raw --no-generateTypes -f cjs,esm,umd --cwd hooks",
		"build:test-utils": "microbundle build --raw --no-generateTypes -f cjs,esm,umd --cwd test-utils",
		"build:compat": "microbundle build --raw --no-generateTypes -f cjs,esm,umd --cwd compat --globals 'preact/hooks=preactHooks'",
		"build:jsx": "microbundle build --raw --no-generateTypes -f cjs,esm,umd --cwd jsx-runtime",
		"postbuild": "node ./config/node-13-exports.js && node ./config/compat-entries.js",
		"dev": "microbundle watch --raw --no-generateTypes --format cjs",
		"dev:hooks": "microbundle watch --raw --no-generateTypes --format cjs --cwd hooks",
		"dev:compat": "microbundle watch --raw --no-generateTypes --format cjs --cwd compat --globals 'preact/hooks=preactHooks'",
		"test": "npm-run-all build lint test:unit",
		"test:install": "playwright install chromium",
		"test:unit": "run-p test:mocha test:vitest:min test:ts",
		"test:vitest": "cross-env COVERAGE=true vitest run",
		"test:vitest:min": "cross-env MINIFY=true vitest run",
		"test:vitest:watch": "vitest",
		"test:ts": "run-p 'test:ts:*'",
		"test:ts:core": "tsc -p test/ts/ && mocha --require \"@babel/register\" test/ts/**/*-test.js",
		"test:ts:compat": "tsc -p compat/test/ts/",
		"test:mocha": "mocha --recursive --require \"@babel/register\" test/shared test/node",
		"test:mocha:watch": "npm run test:mocha -- --watch",
		"lint": "run-s oxlint tsc",
		"tsc": "tsc -p jsconfig-lint.json",
		"oxlint": "oxlint -c oxlint.json src test/browser test/node test/shared debug compat hooks test-utils",
		"format": "oxfmt . --write",
		"format:check": "oxfmt --check ."
	},
	"nano-staged": { "**/*.{js,jsx,mjs,cjs,ts,tsx,yml,json,html,md,css,scss}": ["oxfmt --write --no-error-on-unmatched-pattern"] },
	files: [
		"src",
		"dist",
		"compat/dist",
		"compat/src",
		"compat/client.d.ts",
		"compat/client.js",
		"compat/client.mjs",
		"compat/server.browser.js",
		"compat/server.js",
		"compat/server.mjs",
		"compat/scheduler.js",
		"compat/scheduler.mjs",
		"compat/test-utils.js",
		"compat/test-utils.mjs",
		"compat/jsx-runtime.js",
		"compat/jsx-runtime.mjs",
		"compat/jsx-dev-runtime.js",
		"compat/jsx-dev-runtime.mjs",
		"compat/package.json",
		"debug/dist",
		"debug/src",
		"debug/package.json",
		"devtools/dist",
		"devtools/src",
		"devtools/package.json",
		"hooks/dist",
		"hooks/src",
		"hooks/package.json",
		"jsx-runtime/dist",
		"jsx-runtime/src",
		"jsx-runtime/package.json",
		"test-utils/src",
		"test-utils/package.json",
		"test-utils/dist"
	],
	keywords: [
		"preact",
		"react",
		"ui",
		"user interface",
		"virtual dom",
		"vdom",
		"components",
		"dom diff",
		"front-end",
		"framework"
	],
	authors: ["The Preact Authors (https://github.com/preactjs/preact/contributors)"],
	repository: "preactjs/preact",
	bugs: "https://github.com/preactjs/preact/issues",
	homepage: "https://preactjs.com",
	devDependencies: {
		"@actions/github": "^6.0.0",
		"@actions/glob": "^0.5.0",
		"@babel/core": "^7.26.0",
		"@babel/plugin-transform-react-jsx": "^7.25.9",
		"@babel/plugin-transform-react-jsx-source": "^7.25.9",
		"@babel/preset-env": "^7.26.0",
		"@babel/register": "^7.25.9",
		"@types/chai": "^5.0.1",
		"@types/mocha": "^10.0.0",
		"@types/node": "^18.19.87",
		"@types/sinon": "^17.0.3",
		"@vitest/browser": "^3.2.1",
		"@vitest/coverage-istanbul": "^3.2.1",
		"babel-plugin-transform-rename-properties": "0.1.0",
		"chai": "^5.2.0",
		"coveralls": "^3.1.1",
		"cross-env": "^7.0.3",
		"errorstacks": "^2.4.1",
		"esbuild": "^0.24.0",
		"husky": "^9.1.7",
		"kolorist": "^1.8.0",
		"microbundle": "^0.15.1",
		"mocha": "^11.0.0",
		"npm-run-all2": "^7.0.0",
		"oxfmt": "^0.32.0",
		"oxlint": "^0.15.12",
		"preact-render-to-string": "^6.5.0",
		"prop-types": "^15.8.1",
		"sade": "^1.8.1",
		"sinon": "^19.0.2",
		"sinon-chai": "^4.0.0",
		"terser": "5.16.0",
		"typescript": "5.1.6",
		"undici": "^4.12.0",
		"vite": "^6.2.0",
		"vitest": "^3.2.1",
		"playwright": "^1.52.0"
	},
	peerDependencies: { "preact-render-to-string": ">=5" },
	peerDependenciesMeta: { "preact-render-to-string": { "optional": true } },
	volta: { "node": "20.19.1" }
};
// node_modules/.pnpm/preact@10.29.8/node_modules/preact/jsx-runtime/dist/jsxRuntime.module.js
var f = 0;
Array.isArray;
function u(e, t, n, o, i, u) {
	t || (t = {});
	var a, c, p = t;
	if ("ref" in p) for (c in p = {}, t) "ref" == c ? a = t[c] : p[c] = t[c];
	var l = {
		type: e,
		props: p,
		key: n,
		ref: a,
		__k: null,
		__: null,
		__b: 0,
		__e: null,
		__c: null,
		constructor: void 0,
		__v: --f,
		__i: -1,
		__u: 0,
		__source: i,
		__self: u
	};
	if ("function" == typeof e && (a = e.defaultProps)) for (c in a) void 0 === p[c] && (p[c] = a[c]);
	return l$1.vnode && l$1.vnode(l), l;
}
// e2e/isolates/adapters/preact/app.tsx
var notes = {
	name: "notes.v1",
	schema: { "~standard": {} }
};
function App() {
	const last = useTopic(notes, { from: "earliest" });
	const publish = usePublish(notes);
	const route = useRoute();
	const host = useHost();
	const [text, setText] = d("");
	const count = Number(last ?? "0");
	return /* @__PURE__ */ u("div", { children: [
		/* @__PURE__ */ u("p", {
			class: "fw",
			children: `preact ${package_default.version}`
		}),
		/* @__PURE__ */ u("p", {
			class: "count",
			children: count
		}),
		/* @__PURE__ */ u("button", {
			class: "inc",
			onClick: () => void publish(String(count + 1)),
			children: "+1"
		}),
		/* @__PURE__ */ u("input", {
			class: "field",
			value: text,
			onInput: (e) => setText(e.currentTarget.value)
		}),
		/* @__PURE__ */ u("p", {
			class: "echo",
			children: text.toUpperCase()
		}),
		/* @__PURE__ */ u("button", {
			class: "crash",
			onClick: () => {
				throw new Error("adapter fixture crash");
			},
			children: "crash"
		}),
		/* @__PURE__ */ u("button", {
			class: "go",
			onClick: () => void host.navigate("/next"),
			children: "go"
		}),
		/* @__PURE__ */ u("p", {
			class: "path",
			children: route?.path ?? "…"
		})
	] });
}
var app_default = defineIsolate(App);
export { app_default as default };
