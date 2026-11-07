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
// node_modules/.pnpm/preact@11.1.1/node_modules/preact/dist/preact.mjs
var n;
var t$1;
var i$1;
var u$2;
var f$2;
var e$1;
var o$2;
var l$1;
var c$1;
var a$2;
var s$1;
var h$1 = Symbol.for("pv");
var p$1 = {};
var v$1 = [];
var y$1 = /^m(i|n|o|s|text|space)$/;
var w$1 = Array.isArray;
var d$1 = v$1.slice;
var _$1 = Object.assign;
function g$1(n) {
	n && n.parentNode && n.remove();
}
function k$1(n, t, r) {
	var i, u, f, e = {}, o = arguments.length;
	for (f in t) "key" == f ? i = t[f] : "ref" == f && "function" != typeof n ? u = t[f] : e[f] = t[f];
	return o > 2 && (e.children = o > 3 ? d$1.call(arguments, 2) : r), m$1(n, e, i, u, null);
}
function m$1(r, i, u, f, e) {
	var o = {
		type: r,
		props: i,
		key: u,
		ref: f,
		__k: null,
		__: null,
		__b: 0,
		__e: null,
		__c: null,
		constructor: h$1,
		__v: e || ++t$1,
		__i: -1,
		__u: 0
	};
	return !e && n.vnode && n.vnode(o), o;
}
function M(n) {
	return n.children;
}
function x(n, t) {
	this.props = n, this.context = t, this.__g = 0;
}
function S(n, t) {
	if (null == t) return n.__ && S(n.__, n.__i + 1);
	for (var r; t < n.__k.length; t++) if ((r = n.__k[t]) && r.__e) return r.__e;
	return "function" != typeof n.type || n.props.__P ? null : S(n);
}
function C$1(n) {
	if ((n = n.__) && n.__c && !n.props.__P) return n.__e = null, n.__k.some(function(t) {
		return t && (n.__e = t.__e);
	}), C$1(n);
}
function j$1(t) {
	(8 & t.__g || (t.__g |= 8, i$1.push(t), f$2++)) && u$2 == n.debounceRendering || ((u$2 = n.debounceRendering) || queueMicrotask)(L);
}
function L() {
	var t, r, o, l, c, a, s, p, v;
	try {
		for (r = 1; i$1.length;) i$1.length > r && i$1.sort(e$1), t = i$1.shift(), r = i$1.length, 8 & t.__g && (l = void 0, c = void 0, a = (c = (o = t).__v).__e, s = [], p = [], (v = o.__P) && ((l = _$1({ constructor: h$1 }, c)).__v = c.__v + 1, n.vnode && n.vnode(l), V(v, l, c, o.__n, v.namespaceURI, 32 & c.__u ? [a] : null, s, a || S(c), 32 & c.__u, p), l.__v = c.__v, l.__.__k[l.__i] = l, D$1(s, l, p), c.__ = c.__e = null, l.__e != a && C$1(l)));
	} finally {
		(f$2 = i$1.length) && (u$2 || queueMicrotask)(L);
	}
}
function H(n, t, r, i, u, f, e, o, l, c, a) {
	var s, h, y, w, d, _, g = i.__k || v$1, k = t.length;
	for (l = I(r, t, g, l, k), s = 0; s < k; s++) null != (y = r.__k[s]) && (h = ~y.__i && g[y.__i] || p$1, y.__i = s, _ = V(n, y, h, u, f, e, o, l, c, a), w = y.__e, (h.ref != y.ref || 8 & h.__u) && (h.ref && F$1(h.ref, null, y, h), y.ref && a.push(y.ref, y.__c || w, y)), d = d || w, 4 & y.__u ? (l = q(y, l, n, !h.__v), h.__e && (h.__e = null)) : "function" == typeof y.type && void 0 !== _ ? l = _ : w && (l = w.nextSibling), y.__u &= -21);
	return r.__e = d, l;
}
function I(n, t, r, i, u) {
	var f, e, o, l, c, a, s, p, v, y = r.length, d = y, _ = 0, g = 0, k = n.__k = Array(u);
	for (f = 0; f < u; f++) null != (e = t[f]) && "boolean" != typeof e && "function" != typeof e ? ("object" != typeof e || e.constructor === String ? e = k[f] = m$1(null, e) : w$1(e) ? e = k[f] = m$1(M, { children: e }) : e.constructor === h$1 && e.__b ? e = k[f] = m$1(e.type, e.props, e.key, e.ref, e.__v) : k[f] = e, l = f + _, e.__ = n, e.__b = n.__b + 1, o = null, ~(c = e.__i = O(e, r, l, d)) && (d--, (o = r[c]) && (o.__u |= 2)), o && o.__v ? (e.__u |= 16, c == l - 1 ? _-- : c == l + 1 ? _++ : c != l && (c > l ? _-- : _++, g = 1)) : (~c || (u > y ? _-- : u < y && _++), "function" != typeof e.type && (e.__u |= 4))) : k[f] = null;
	if (g) {
		for (a = [], s = [], f = 0; f < u; f++) if ((e = k[f]) && 16 & e.__u) {
			for (_ = 0, p = a.length; _ < p;) a[v = _ + p >> 1] < e.__i ? _ = v + 1 : p = v;
			a[_] = e.__i, s[f] = _ + 1;
		}
		for (_ = a.length; f--;) s[f] && (s[f] == _ ? _-- : k[f].__u |= 4);
	}
	if (d) for (f = 0; f < y; f++) !(o = r[f]) || 2 & o.__u || (o.__e == i && (i = S(o)), G$1(o, o));
	return i;
}
function q(n, t, r, i) {
	var u, f, e, o;
	if ("function" == typeof n.type) {
		if (n.props.__P) return t;
		if (u = n.__k) for (f = 0; f < u.length; f++) u[f] && (u[f].__ = n, t = q(u[f], t, r, !1));
		return t;
	}
	for (t && !t.parentNode && (t = S(n)) && !t.parentNode && (t = null), e = n.__e, o = t; o && 8 == o.nodeType;) o = o.nextSibling;
	for (e != o && (!i && r.moveBefore && e.parentNode ? r.moveBefore(e, t) : r.insertBefore(e, t || null)), t = e; (t = t && t.nextSibling) && 8 == t.nodeType && !t.data.startsWith("$s"););
	return t;
}
function O(n, t, r, i) {
	var u, f = n.key, e = n.type, o = t[r], l = o && !(2 & o.__u);
	if (null === o && null == f || l && f == o.key && e == o.type) return r;
	if (i > (l ? 1 : 0)) {
		for (u = r - 1; u >= 0; u--) if ((o = t[u]) && !(2 & o.__u) && f == o.key && e == o.type) return u;
		for (u = r + 1; u < t.length; u++) if ((o = t[u]) && !(2 & o.__u) && f == o.key && e == o.type) return u;
	}
	return -1;
}
function P(n, t, r) {
	r ??= "", "-" == t[0] ? n.setProperty(t, r) : n[t] = r;
}
function T(n, t, r, i, u) {
	var f, e;
	if ("style" == t) if ("string" == typeof r) n.style.cssText = r;
	else {
		if ("string" == typeof i && (n.style.cssText = i = ""), i) for (t in i) r && t in r || P(n.style, t);
		if (r) for (t in r) i && r[t] == i[t] || P(n.style, t, r[t]);
	}
	else if ("o" == t[0] && "n" == t[1]) (n.__e || (n.__e = {}))[t] = r, r && i || (e = a$2[t] || (a$2[t] = N(t)), (n.__a || (n.__a = {}))[t] = c$1, f = t != (t = t.replace(l$1, "$1")), (t = t.slice(2))[0] < "a" && (t = t.toLowerCase()), r ? n.addEventListener(t, e, f) : n.removeEventListener(t, e, f));
	else {
		if ("http://www.w3.org/2000/svg" == u) t = t.replace(/xlink(H|:h)/, "h").replace(/sName$/, "s");
		else if ("width" != t && "height" != t && "href" != t && "list" != t && "form" != t && "tabIndex" != t && "download" != t && "rowSpan" != t && "colSpan" != t && "role" != t && "popover" != t && t in n) try {
			n[t] = null == r ? "" : r;
			return;
		} catch (n) {}
		if ("function" == typeof r) return;
		null == r || !1 === r && "-" != t[4] ? n.removeAttribute(t) : n.setAttribute(t, "popover" == t && 1 == r ? "" : r);
	}
}
function N(t) {
	return function(r) {
		var i = this.__e;
		if (i) {
			if (i = i[t], null == r[o$2]) r[o$2] = c$1++;
			else if (r[o$2] < this.__a[t]) return;
			return i(n.event ? n.event(r) : r);
		}
	};
}
function V(t, r, i, u, f, e, o, l, c, a) {
	var s, p, y, d, k, b, m, $, C, j, L, I, q, A, O, P, T, N, V = r.type;
	if (r.constructor !== h$1) return null;
	128 & i.__u && (c = 32 & i.__u, s = i.__c.__z) && (r.__u |= c, p = e = [], 8 == s.nodeType ? l = z$1(s, e) : e.push(s), l = e[0] || l), (s = n.__b) && s(r);
	n: if ("function" == typeof V) {
		y = o.length;
		try {
			if ($ = r.props, C = (s = V.prototype) && s.render, j = (s = V.contextType) && u[s.__c], L = s ? j ? j.props.value : s.__ : u, (d = i.__c) ? (r.__c = d, 2 & d.__g && (d.__g |= 1)) : (C ? r.__c = d = new V($, L) : (r.__c = d = new x($, L), d.constructor = V, d.render = J), j && j.sub(d), d.state || (d.state = {}), d.__n = u, d.__g |= 8, d.__h = [], d.__k = []), C && (d.__s || (d.__s = d.state), V.getDerivedStateFromProps && (d.__s == d.state && (d.__s = _$1({}, d.__s)), _$1(d.__s, V.getDerivedStateFromProps($, d.__s)))), k = d.props, b = d.state, d.__v = r, i.__c) {
				if ($ !== k && C && !V.getDerivedStateFromProps && d.componentWillReceiveProps && d.componentWillReceiveProps($, L), r.__v == i.__v && !(8 & d.__g) || !(4 & d.__g) && d.shouldComponentUpdate && !1 === d.shouldComponentUpdate($, d.__s, L)) {
					r.__v != i.__v && (d.props = $, d.state = d.__s, d.__g &= -9), r.__e = i.__e, r.__k = i.__k, r.__k.some(function(n) {
						n && (n.__ = r);
					}), v$1.push.apply(d.__h, d.__k), d.__k = [], d.__h.length && o.push(d), l = S(i);
					break n;
				}
				d.componentWillUpdate && d.componentWillUpdate($, d.__s, L), C && d.componentDidUpdate && d.__h.push(function() {
					d.componentDidUpdate(k, b, m);
				});
			} else C && !V.getDerivedStateFromProps && d.componentWillMount && d.componentWillMount(), C && d.componentDidMount && d.__h.push(d.componentDidMount);
			if (d.context = L, d.props = $, d.__P = t, d.__g &= -5, I = n.__r, q = 0, C) d.state = d.__s, d.__g &= -9, I && I(r), s = d.render(d.props, d.state, d.context), v$1.push.apply(d.__h, d.__k), d.__k = [];
			else do
				d.__g &= -9, I && I(r), s = d.render(d.props, d.state, d.context), d.state = d.__s;
			while (8 & d.__g && ++q < 25);
			d.state = d.__s, d.getChildContext && (u = _$1({}, u, d.getChildContext())), C && i.__c && d.getSnapshotBeforeUpdate && (m = d.getSnapshotBeforeUpdate(k, b)), A = s && s.type === M && null == s.key ? s.props.children : s, $.__P && (s = l, f = (t = $.__P).namespaceURI, c = e = null, i.props && i.props.__P != t && (i.__k.some(function(n) {
				n && G$1(n, n);
			}), i.__k = null), l = i.__k ? S(i, 0) : null), l = H(t, w$1(A) ? A : [A], r, i, u, f, e, o, l, c, a), $.__P && (r.__e = null, l = s), r.__u &= -161, p && p.some(g$1), d.__h.length && o.push(d), 1 & d.__g && (d.__g &= -4);
		} catch (t) {
			if (o.length = y, r.__v = null, c || e) if (t.then) {
				if (O = 0, r.__u |= 128 | c, e) {
					for (~(T = e.indexOf(l || void 0)) || (T = e.length); (N = e[T - 1]) && 8 == N.nodeType;) T--;
					for (; T < e.length; T++) if (N = e[T]) {
						if (e[T] = null, 8 == N.nodeType) {
							if (N.data.startsWith("$s")) O++ || (P = N);
							else if (O && N.data.startsWith("/$s") && !--O) break;
						} else if (!O) break;
					}
				}
				if (!P) {
					for (; l && 8 == l.nodeType && l.nextSibling;) l = l.nextSibling;
					P = l;
				}
				(s = z$1(P = r.__c.__z || (r.__c.__z = P))) ? (r.__e = P, l = s) : r.__e = l, l = l && l.nextSibling;
			} else e && e.some(g$1);
			else r.__e = i.__e;
			r.__k || (r.__k = i.__k || []), t.then || B$1(r), n.__e(t, r, i);
		}
	} else l = r.__e = E$1(i.__e, r, i, u, f, e, o, c, a, t);
	return (s = n.diffed) && s(r), l;
}
function z$1(n, t) {
	if (n && 8 == n.nodeType && n.data.startsWith("$s")) for (var r = 1; n = n.nextSibling;) {
		if (8 == n.nodeType) {
			if (n.data.startsWith("$s")) r++;
			else if (n.data.startsWith("/$s") && !--r) return n;
		}
		t && t.push(n);
	}
}
function B$1(n) {
	n && (n.__c && (n.__c.__g |= 4), n.__k && n.__k.some(B$1));
}
function D$1(t, r, i) {
	for (var u = 0; u < i.length;) F$1(i[u++], i[u++], i[u++]);
	n.__c && n.__c(r, t), t.some(function(r) {
		try {
			t = r.__h, r.__h = [], t.some(function(n) {
				n.call(r);
			});
		} catch (t) {
			n.__e(t, r.__v);
		}
	});
}
function E$1(t, r, i, u, f, e, o, l, c, a) {
	var s, h, v, _, k, b, m, $, M, x = i.props || p$1, C = r.props, j = r.type;
	if ("svg" == j ? f = "http://www.w3.org/2000/svg" : "math" == j ? f = "http://www.w3.org/1998/Math/MathML" : f || (f = "http://www.w3.org/1999/xhtml"), e) {
		for (s = 0; s < e.length; s++) if ((k = e[s]) && (j ? k.localName == j : 3 == k.nodeType)) {
			t = k, e[s] = null;
			break;
		}
	}
	if (!t) {
		if ($ = a.ownerDocument || document, !j) return $.createTextNode(C);
		t = $.createElementNS(f, j, C.is && C), l && (n.__m && n.__m(r, e), l = !1), e = null;
	}
	if (j) {
		if (a = "template" == j && t.content || t, e = "textarea" == j && null != C.defaultValue ? null : e && d$1.call(a.childNodes), !l && e) for (x = {}, s = 0; s < t.attributes.length; s++) x[(k = t.attributes[s]).name] = k.value;
		for (s in x) k = x[s], "dangerouslySetInnerHTML" == s ? v = k : "children" == s || s in C || "value" == s && "defaultValue" in C || "checked" == s && "defaultChecked" in C || T(t, s, null, k, f);
		for (s in M = 1 & i.__u, C) k = C[s], "children" == s ? _ = k : "dangerouslySetInnerHTML" == s ? h = k : "value" == s ? b = k : "checked" == s ? m = k : l && "function" != typeof k || !(x[s] !== k || M && null != k) || T(t, s, k, x[s], f);
		h ? (l || v && (h.__html == v.__html || h.__html == t.innerHTML) || (t.innerHTML = h.__html), r.__k = []) : (v && (t.textContent = ""), ("foreignObject" == j || "http://www.w3.org/1998/Math/MathML" == f && y$1.test(j)) && (f = "http://www.w3.org/1999/xhtml"), H(a, w$1(_) ? _ : [_], r, i, u, f, e, o, e ? e[0] : i.__k && S(i, 0), l, c), e && e.some(g$1)), l && "textarea" != j || (s = "value", "progress" == j && null == b ? t.removeAttribute(s) : null == b || b === t[s] && ("progress" != j || b) || T(t, s, b, x[s], f), s = "checked", null != m && m != t[s] && T(t, s, m, x[s], f));
	} else x === C || l && t.data == C || (t.data = C);
	return t;
}
function F$1(t, r, i, u) {
	try {
		"function" == typeof t ? r ? r.__x = t(r) || 1 : u && (u = u.__c || u.__e) && (r = u.__x) && (u.__x = null, "function" == typeof r ? r() : t(null)) : t.current = r;
	} catch (t) {
		n.__e(t, i);
	}
}
function G$1(t, r, i) {
	var u, f, e, o;
	if (n.unmount && n.unmount(t), !(u = t.ref) || u.current && u.current != t.__e || F$1(u, null, r, t), u = t.__c) {
		if (u.componentWillUnmount) try {
			u.componentWillUnmount();
		} catch (t) {
			n.__e(t, r);
		}
		u.__P = u.__n = null;
	}
	if (u = t.__k) for (o = 0; o < u.length; o++) u[o] && G$1(u[o], r, "function" != typeof t.type || i && !t.props.__P);
	!i && (u = t.__c) && (u = u.__z) && (f = z$1(u, e = [])) && (u == t.__e && e.some(g$1), g$1(f), g$1(u)), (u = t.__e) && (i || g$1(u), u.__e && (u.__e = null)), t.__e = t.__c = t.__ = null;
}
function J(n, t, r) {
	return this.constructor(n, r);
}
function K(t, r) {
	var i, u, f, e;
	n.__ && n.__(t, r), 9 == r.nodeType && (r = r.documentElement), u = (i = t && 32 & t.__u) ? null : r.__k, r.__k = m$1(M, { children: [t] }), f = [], e = [], V(r, r.__k, u || p$1, p$1, r.namespaceURI, u ? null : r.firstChild ? d$1.call(r.childNodes) : null, f, u ? u.__e : r.firstChild, i, e), D$1(f, r.__k, e), r.__k.props.children = null;
}
function R(n) {
	function t(n) {
		var r, i;
		return this.getChildContext || (r = /* @__PURE__ */ new Set(), (i = {})[t.__c] = this, this.getChildContext = function() {
			return i;
		}, this.shouldComponentUpdate = function(n) {
			this.props.value != n.value && r.forEach(function(n) {
				n.__g |= 4, j$1(n);
			});
		}, this.sub = function(n) {
			r.add(n);
			var t = n.componentWillUnmount;
			n.componentWillUnmount = function() {
				r.delete(n), t && t.call(n);
			};
		}), n.children;
	}
	return t.__c = "__cC" + s$1++, t.__ = n, t.Provider = (t.Consumer = function(n, t) {
		return n.children(t);
	}).contextType = t, t;
}
n = { __e: function(n, t, r, i) {
	for (var u, e, o; t = t.__;) if ((u = t.__c) && !(1 & u.__g)) {
		u.__g |= 4;
		try {
			if ((o = (e = u.constructor) && e.getDerivedStateFromError) && u.setState(e.getDerivedStateFromError(n)), u.componentDidCatch && (u.componentDidCatch(n, i || {}), o = 1), o && 8 & u.__g) return void (u.__g |= 2);
		} catch (t) {
			n = t;
		}
	}
	throw f$2 = 0, n;
} }, t$1 = 0, x.prototype.setState = function(n, t) {
	var r = this.__s;
	r && r != this.state || (r = this.__s = _$1({}, this.state)), "function" == typeof n && (n = n(_$1({}, r), this.props)), n && (_$1(r, n), this.__v && (t && this.__k.push(t), j$1(this)));
}, x.prototype.forceUpdate = function(n) {
	this.__v && (this.__g |= 4, n && this.__h.push(n), j$1(this));
}, x.prototype.render = M, i$1 = [], f$2 = 0, e$1 = function(n, t) {
	return n.__v.__b - t.__v.__b;
}, o$2 = Symbol(), l$1 = /(PointerCapture)$|Capture$/i, c$1 = 0, a$2 = {}, s$1 = 0;
// node_modules/.pnpm/preact@11.1.1/node_modules/preact/hooks/dist/hooks.mjs
var t;
var r;
var u$1;
var i;
var o$1 = Object.is;
var f$1 = 0;
var c = [];
var e = [];
var a$1 = n;
var v = a$1.__b;
var l = a$1.__r;
var m = a$1.diffed;
var h = a$1.__c;
var s = a$1.unmount;
var p = a$1.__;
function y(n, t) {
	a$1.__h && a$1.__h(r, n, f$1 || t), f$1 = 0;
	var u = r.__H || (r.__H = {
		__: [],
		__h: []
	});
	return n >= u.__.length && u.__.push({}), u.__[n];
}
function d(n) {
	return f$1 = 1, _(G, n);
}
function _(n, u, i) {
	var f = y(t++, 2);
	if (f.t = n, !f.__c && (f.__ = [i ? i(u) : G(void 0, u), function(n) {
		var t = f.__N ? f.__N[0] : f.__[0], r = f.t(t, n);
		o$1(t, r) || (f.__N = [r, f.__[1]], f.__c.setState({}));
	}], f.__c = r, !r.__f)) {
		r.__f = !0;
		var c = r.shouldComponentUpdate;
		r.shouldComponentUpdate = function(n, t, r) {
			var u = this.__H;
			if (!u) return !0;
			var i = !1, f = this.props != n;
			if (u.__.some(function(n) {
				n.__N && (i = !0, o$1(n.__[0], n.__N[0]) || (f = !0));
			}), c) {
				var e = c.call(this, n, t, r);
				return i ? e || f : e;
			}
			return !i || f;
		};
	}
	return f.__;
}
function F(n, u) {
	var i = y(t++, 4);
	!a$1.__s && E(i.__H, u) && (i.__P = !1, i.__ = n, i.u = u, r.__h.push(i));
}
function w(n, r) {
	var u = y(t++, 7);
	return E(u.__H, r) && (u.__ = n(), u.__H = r), u.__;
}
function b(n, t) {
	return f$1 = 8, w(function() {
		return n;
	}, t);
}
function j(n) {
	var u = r.context[n.__c], i = y(t++, 9);
	return i.c = n, u ? (i.__ ?? (i.__ = !0, u.sub(r)), u.props.value) : n.__;
}
function g() {
	var n;
	do {
		for (; n = e.shift();) try {
			C(n);
		} catch (t) {
			a$1.__e(t, { __: (n = n.__P) && n.__v });
		}
		for (; n = c.shift();) {
			var t = n.__H;
			if (n.__P && t) try {
				t.__h.some(C), t.__h.some(D), t.__h = [];
			} catch (r) {
				t.__h = [], a$1.__e(r, n.__v);
			}
		}
	} while (e.length);
}
a$1.__b = function(n) {
	r = null, v && v(n);
}, a$1.__ = function(n, t) {
	n && t.__k && t.__k.__m && (n.__m = t.__k.__m), p && p(n, t);
}, a$1.__r = function(n) {
	l && l(n), t = 0;
	var i = (r = n.__c).__H;
	i && (u$1 == r ? r.__h = [] : (i.__h.some(C), i.__h.some(D), t = 0), i.__h = [], i.__.some(function(n) {
		n.__N && (n.__ = n.__N), n.u = n.__N = void 0;
	})), u$1 = r;
}, a$1.diffed = function(n) {
	m && m(n);
	var t = n.__c;
	t && t.__H && (t.__H.__h.length && B(c.push(t)), t.__H.__.some(function(n) {
		n.u && (n.__H = n.u);
	})), u$1 = r = null;
}, a$1.__c = function(n, t) {
	t.some(function(n) {
		try {
			n.__h.some(C), n.__h = n.__h.filter(function(n) {
				return !n.__ || D(n);
			});
		} catch (t) {
			n.__h = [function() {
				throw t;
			}];
		}
	}), h && h(n, t);
}, a$1.unmount = function(n) {
	s && s(n);
	var t, r, u = n.__c;
	u && u.__H && (u.__H.__.some(function(u) {
		try {
			if (u.__P && u.__c) {
				if (void 0 === r) {
					for (r = n.__; r && (!r.__c || !r.__c.__P);) r = r.__;
					r = r && r.__c;
				}
				u.__P = r, B(e.push(u));
			} else C(u);
		} catch (n) {
			t = n;
		}
	}), u.__H = void 0, t && a$1.__e(t, u.__v));
};
var k = "function" == typeof requestAnimationFrame;
function z(n) {
	var t, r = function() {
		clearTimeout(u), k && cancelAnimationFrame(t), setTimeout(n);
	}, u = setTimeout(r, 35);
	k && (t = requestAnimationFrame(r));
}
function B(n) {
	1 != n && i == a$1.requestAnimationFrame || ((i = a$1.requestAnimationFrame) || z)(g);
}
function C(n) {
	var t = r, u = n.__c;
	"function" == typeof u && (n.__c = void 0, u()), r = t;
}
function D(n) {
	var t = r;
	n.__c = n.__(), r = t;
}
function E(n, t) {
	return !n || n.length != t.length || t.some(function(t, r) {
		return !o$1(t, n[r]);
	});
}
function G(n, t) {
	return "function" == typeof t ? t(n) : t;
}
// packages/preact/src/context.ts
var IsolateCtx = R(null);
/** The isolate context. Throws outside a component that `defineIsolate` rendered. */
function useIsolate() {
	const ctx = j(IsolateCtx);
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
			K(k$1(IsolateCtx.Provider, { value: ctx }, k$1(Component, { config: ctx.config })), container);
			ctx.onShutdown(() => {
				K(null, container);
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
	F(() => {
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
	return b((value, o = {}) => bus.publish(topic, o.key === void 0 ? { value } : {
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
	version: "11.1.1",
	"private": false,
	publishConfig: {
		"access": "public",
		"provenance": true
	},
	description: "Fast 4kb React-compatible Virtual DOM library.",
	main: "dist/preact.mjs",
	module: "dist/preact.mjs",
	source: "src/index.js",
	exports: {
		".": {
			"types": "./src/index.d.ts",
			"default": "./dist/preact.mjs"
		},
		"./compat": {
			"types": "./compat/src/index.d.ts",
			"default": "./compat/dist/compat.mjs"
		},
		"./debug": {
			"types": "./debug/src/index.d.ts",
			"default": "./debug/dist/debug.mjs"
		},
		"./devtools": {
			"types": "./devtools/src/index.d.ts",
			"default": "./devtools/dist/devtools.mjs"
		},
		"./hooks": {
			"types": "./hooks/src/index.d.ts",
			"default": "./hooks/dist/hooks.mjs"
		},
		"./test-utils": {
			"types": "./test-utils/src/index.d.ts",
			"default": "./test-utils/dist/testUtils.mjs"
		},
		"./compat/test-utils": {
			"types": "./test-utils/src/index.d.ts",
			"default": "./test-utils/dist/testUtils.mjs"
		},
		"./jsx-runtime": {
			"types": "./jsx-runtime/src/index.d.ts",
			"default": "./jsx-runtime/dist/jsxRuntime.mjs"
		},
		"./jsx-dev-runtime": {
			"types": "./jsx-runtime/src/index.d.ts",
			"default": "./jsx-runtime/dist/jsxRuntime.mjs"
		},
		"./compat/client": {
			"types": "./compat/client.d.ts",
			"import": "./compat/client.mjs",
			"require": "./compat/client.js"
		},
		"./compat/server": {
			"types": "./compat/server.d.ts",
			"browser": "./compat/server.browser.mjs",
			"import": "./compat/server.mjs",
			"require": "./compat/server.js"
		},
		"./compat/server.browser": {
			"types": "./compat/server.d.ts",
			"default": "./compat/server.browser.mjs"
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
		"./compat/compiler-runtime": {
			"types": "./compat/compiler-runtime.d.ts",
			"import": "./compat/compiler-runtime.mjs",
			"require": "./compat/compiler-runtime.js"
		},
		"./compat/scheduler": {
			"types": "./compat/scheduler.d.ts",
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
	"nano-staged": { "**/*.{js,jsx,mjs,cjs,ts,tsx,yml,json,html,md,css,scss}": ["oxfmt --write --no-error-on-unmatched-pattern"] },
	files: [
		"src",
		"dist",
		"compat/dist",
		"compat/src",
		"compat/client.d.ts",
		"compat/client.js",
		"compat/client.mjs",
		"compat/compiler-runtime.d.ts",
		"compat/compiler-runtime.js",
		"compat/compiler-runtime.mjs",
		"compat/server.d.ts",
		"compat/server.browser.mjs",
		"compat/server.js",
		"compat/server.mjs",
		"compat/scheduler.d.ts",
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
	repository: {
		"type": "git",
		"url": "git+https://github.com/preactjs/preact.git"
	},
	bugs: "https://github.com/preactjs/preact/issues",
	homepage: "https://preactjs.com",
	devDependencies: {
		"@babel/core": "^7.28.0",
		"@babel/preset-env": "^7.29.7",
		"@preact/signals": "^2.11.4",
		"@rollup/plugin-babel": "^6.1.0",
		"@types/chai": "^5.2.2",
		"@types/node": "^22.20.1",
		"@vitest/browser": "^5.0.0",
		"@vitest/browser-playwright": "^5.0.0",
		"@vitest/coverage-v8": "^5.0.0",
		"babel-plugin-transform-rename-properties": "0.1.0",
		"chai": "^6.2.2",
		"cross-env": "^7.0.3",
		"husky": "^9.1.7",
		"kolorist": "^1.8.0",
		"nano-staged": "^1.0.2",
		"npm-run-all2": "^7.0.0",
		"oxfmt": "^0.32.0",
		"oxlint": "^1.8.0",
		"playwright": "^1.54.1",
		"preact-render-to-string": "^6.8.2",
		"prop-types": "^15.8.1",
		"rollup": "^4.62.2",
		"terser": "5.16.0",
		"typescript": "5.1.6",
		"vitest": "^5.0.0"
	},
	peerDependencies: { "preact-render-to-string": ">=6.7.0" },
	peerDependenciesMeta: { "preact-render-to-string": { "optional": true } },
	volta: { "node": "22.22.2" },
	scripts: {
		"build": "node ./scripts/build.mjs",
		"postbuild": "node ./config/compat-entries.js",
		"dev": "node ./scripts/build.mjs --watch",
		"dev:hooks": "node ./scripts/build.mjs --watch hooks",
		"dev:compat": "node ./scripts/build.mjs --watch compat",
		"test": "npm-run-all build lint test:unit",
		"test:install": "playwright install chromium",
		"test:unit": "run-p test:vitest:min test:ts",
		"test:vitest": "cross-env COVERAGE=true vitest run",
		"test:vitest:min": "cross-env MINIFY=true vitest run",
		"test:vitest:watch": "vitest",
		"test:ts": "run-p 'test:ts:*'",
		"test:ts:core": "tsc -p test/ts/",
		"test:ts:compat": "tsc -p compat/test/ts/",
		"lint": "run-s oxlint tsc",
		"tsc": "tsc -p jsconfig-lint.json",
		"oxlint": "oxlint src test/browser test/node test/shared debug compat hooks test-utils",
		"format": "oxfmt . --write",
		"format:check": "oxfmt --check ."
	}
};
// node_modules/.pnpm/preact@11.1.1/node_modules/preact/jsx-runtime/dist/jsxRuntime.mjs
var f = Symbol.for("pv");
var o = 0;
Array.isArray;
function a(t, e, n$1, u, a, i) {
	e || (e = {});
	var c, l, p = e;
	if ("ref" in p && "function" != typeof t) for (l in p = {}, e) "ref" == l ? c = e[l] : p[l] = e[l];
	var s = {
		type: t,
		props: p,
		key: n$1,
		ref: c,
		__k: null,
		__: null,
		__b: 0,
		__e: null,
		__c: null,
		constructor: f,
		__v: --o,
		__i: -1,
		__u: 0
	};
	return (a || i) && (s.__source = a, s.__self = i), n.vnode && n.vnode(s), s;
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
	return /* @__PURE__ */ a("div", { children: [
		/* @__PURE__ */ a("p", {
			class: "fw",
			children: `preact ${package_default.version}`
		}),
		/* @__PURE__ */ a("p", {
			class: "count",
			children: count
		}),
		/* @__PURE__ */ a("button", {
			class: "inc",
			onClick: () => void publish(String(count + 1)),
			children: "+1"
		}),
		/* @__PURE__ */ a("input", {
			class: "field",
			value: text,
			onInput: (e) => setText(e.currentTarget.value)
		}),
		/* @__PURE__ */ a("p", {
			class: "echo",
			children: text.toUpperCase()
		}),
		/* @__PURE__ */ a("button", {
			class: "crash",
			onClick: () => {
				throw new Error("adapter fixture crash");
			},
			children: "crash"
		}),
		/* @__PURE__ */ a("button", {
			class: "go",
			onClick: () => void host.navigate("/next"),
			children: "go"
		}),
		/* @__PURE__ */ a("p", {
			class: "path",
			children: route?.path ?? "…"
		})
	] });
}
var app_default = defineIsolate(App);
export { app_default as default };
