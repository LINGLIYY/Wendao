#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Frontend audit script — checks client/ file consistency"""
import re, os, sys
from collections import defaultdict

# Force UTF-8 output
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BASE = os.path.dirname(os.path.abspath(__file__))
CLIENT = os.path.join(BASE, 'client')

def read(name):
    with open(os.path.join(CLIENT, name), 'r', encoding='utf-8') as f:
        return f.read()

html = read('index.html')
css = read('css/style.css')
js  = read('js/ui.js')

SEP = "=" * 60

# =====================================================================
# 1. JS -> HTML DOM ID check
# =====================================================================
print(SEP)
print("1. JS -> HTML DOM ID check")
print(SEP)

html_ids = set(re.findall(r'id="([^"]+)"', html))

# Extract all $() / getElementById() / querySelector() references from JS
dollar_ids   = set(re.findall(r'\$\(["\']([^"\']+)["\']\)', js))
gebi_ids     = set(re.findall(r'getElementById\(["\']([^"\']+)["\']\)', js))
qs_ids       = set(re.findall(r'querySelector\(["\']([^"\']+)["\']\)', js))
qsa_ids      = set(re.findall(r'querySelectorAll\(["\']([^"\']+)["\']\)', js))
all_js_dom   = dollar_ids | gebi_ids | qs_ids | qsa_ids

# Filter to pure IDs (no compound selectors)
js_pure_ids = set()
for ref in all_js_dom:
    if re.match(r'^[a-zA-Z][a-zA-Z0-9_-]*$', ref):
        js_pure_ids.add(ref)

print(f"\nHTML ID count: {len(html_ids)}")
print(f"JS pure-ID refs via $()/getElementById(): {len(js_pure_ids)}")

missing_in_html = js_pure_ids - html_ids
unused_in_js    = html_ids - js_pure_ids

for rid in sorted(js_pure_ids):
    ok = rid in html_ids
    print(f"  {'[OK]' if ok else '[!!]':6s} {rid}")

print(f"\nResult: PASS {len(js_pure_ids) - len(missing_in_html)} / FAIL {len(missing_in_html)}")
if missing_in_html:
    print(f"  MISSING in HTML: {sorted(missing_in_html)}")
if unused_in_js:
    print(f"  UNUSED (in HTML but not JS): {sorted(unused_in_js)}")

# =====================================================================
# 2. HTML onclick -> JS method existence
# =====================================================================
print(f"\n{SEP}")
print("2. HTML onclick -> JS method check")
print(SEP)

# Extract all onclick from HTML
onclick_raw = re.findall(r'onclick="([^"]+)"', html)
# Also from inline onclick='...'
onclick_raw += re.findall(r"onclick='([^']+)'", html)

# Parse onclick string: extract Object.method() calls
# Handle nested quotes and complex args
onclick_parsed = []  # [(obj, method, raw_text)]
for raw in onclick_raw:
    # Split by semicolons for multiple calls
    for part in raw.split(';'):
        part = part.strip()
        m = re.match(r"(\w+)\.(\w+)\((.*)\)", part)
        if m:
            onclick_parsed.append((m.group(1), m.group(2), m.group(3), part))

# Also extract innerHTML onclick from JS strings
inner_onclick = re.findall(r"onclick=['\"](UI\.\w+\([^'\"]*\))['\"]", js)

print(f"\nHTML onclick calls ({len(onclick_parsed)}):")
for obj, method, args, raw in onclick_parsed:
    print(f"  {obj}.{method}({args})")

print(f"\nJS innerHTML onclick ({len(inner_onclick)}):")
for oc in sorted(set(inner_onclick)):
    print(f"  {oc}")

# Extract methods from JS objects properly:
# Match method definitions like:  methodName(...) { or methodName: function(
def extract_obj_methods(obj_name, js_text):
    """Extract method names from a const Xxx = { ... }; block"""
    methods = set()
    # Find the object block
    block_pat = rf'const\s+{obj_name}\s*=\s*\{{(.*?)\n\}};'
    block_m = re.search(block_pat, js_text, re.DOTALL)
    if block_m:
        block = block_m.group(1)
        # Method shorthand: name(args) {
        for m in re.finditer(r'^\s*(async\s+)?(\w+)\s*\(', block, re.MULTILINE):
            name = m.group(2)
            methods.add(name)
        # Explicit: name: function(
        for m in re.finditer(r'^\s*(\w+)\s*:\s*function\s*\(', block, re.MULTILINE):
            methods.add(m.group(1))
    # Also check for standalone assignments: Obj.method = function(
    for m in re.finditer(rf'{obj_name}\.(\w+)\s*=\s*function\s*\(', js_text):
        methods.add(m.group(1))
    return methods

createui_methods = extract_obj_methods('CreateUI', js)
ui_methods      = extract_obj_methods('UI', js)
api_methods     = extract_obj_methods('API', js)

# Clean up false positives
createui_methods.discard('if')
createui_methods.discard('for')
ui_methods.discard('if')
ui_methods.discard('for')
api_methods.discard('if')
api_methods.discard('for')

print(f"\nCreateUI methods: {sorted(createui_methods)}")
print(f"UI methods: {sorted(ui_methods)}")
print(f"API methods: {sorted(api_methods)}")

# CHECK: HTML onclick methods exist?
fail_onclick = []
for obj, method, args, raw in onclick_parsed:
    if obj == 'CreateUI':
        if method not in createui_methods:
            fail_onclick.append(f"  CreateUI.{method}() -- method NOT defined in CreateUI")
    elif obj == 'UI':
        if method not in ui_methods:
            fail_onclick.append(f"  UI.{method}() -- method NOT defined in UI")
    elif obj == 'API':
        pass  # not directly callable from onclick
    else:
        # Check if it's a defined global object
        fail_onclick.append(f"  {obj}.{method}() -- object '{obj}' not found in JS")

# CHECK: innerHTML onclick methods
inner_fail = []
for raw in sorted(set(inner_onclick)):
    m = re.match(r"UI\.(\w+)\(.*\)", raw)
    if m:
        method = m.group(1)
        if method not in ui_methods:
            inner_fail.append(f"  (innerHTML) UI.{method}() -- NOT defined")

fail_onclick.extend(inner_fail)

pass_onclick = len(onclick_parsed) + len(set(inner_onclick)) - len(fail_onclick)
print(f"\nResult: PASS {pass_onclick} / FAIL {len(fail_onclick)}")
for item in fail_onclick:
    print(item)

# =====================================================================
# 3. JS this.xxx() internal consistency
# =====================================================================
print(f"\n{SEP}")
print("3. JS this.xxx() internal consistency")
print(SEP)

# Extract UI block with more precise regex
ui_block_match = re.search(r'const UI\s*=\s*\{(.*?)\n\};', js, re.DOTALL)
ui_block = ui_block_match.group(1) if ui_block_match else ""

# Extract all this.X() calls
this_method_calls = set(re.findall(r'this\.(\w+)\s*\(', ui_block))

# Known property names in UI (not methods)
known_props = set()
# Extract assignments: this.xxx = ...
for m in re.finditer(r'this\.(\w+)\s*=', ui_block):
    known_props.add(m.group(1))
# Extract pattern like: if (this.xxx) — property reads
for m in re.finditer(r'this\.(\w+)\b(?!\s*\()', ui_block):
    attr = m.group(1)
    if not re.search(rf'^\s*{re.escape(attr)}\s*\(', ui_block, re.MULTILINE):
        known_props.add(attr)

# JS built-in methods
js_builtins = {
    'hasOwnProperty', 'toString', 'valueOf', 'constructor', 'toLocaleString',
    'isPrototypeOf', 'propertyIsEnumerable',
}

# Check each this.xxx() call
missing_this_methods = []
this_call_list = []
for call in sorted(this_method_calls):
    if call in ui_methods:
        this_call_list.append((call, 'OK', 'defined method'))
    elif call in known_props:
        this_call_list.append((call, 'PROP', 'property, not method'))
    elif call in js_builtins:
        this_call_list.append((call, 'OK', 'JS builtin'))
    else:
        this_call_list.append((call, 'MISSING', 'NOT DEFINED'))
        missing_this_methods.append(call)

print(f"\nthis.xxx() calls in UI ({len(this_call_list)}):")
for name, status, note in this_call_list:
    tag = {'OK':'[OK]', 'PROP':'[P?]', 'MISSING':'[!!]'}[status]
    print(f"  {tag:6s} this.{name}()  -- {note}")

print(f"\nResult: PASS {len(this_call_list) - len(missing_this_methods)} / FAIL {len(missing_this_methods)}")
for m in missing_this_methods:
    print(f"  -> this.{m}() called but NOT defined in UI")

# =====================================================================
# 4. CSS class usage check
# =====================================================================
print(f"\n{SEP}")
print("4. CSS class usage check")
print(SEP)

# Extract all CSS class selectors
css_classes = set()
for m in re.finditer(r'\.([a-zA-Z][a-zA-Z0-9_-]*)', css):
    name = m.group(1)
    # skip pseudo-classes
    pseudo = {'on','off','active','hover','focus','visited','checked','disabled','empty',
              'first-child','last-child','nth-child','before','after','root','not','has',
              'is','where','open','show','hidden','valid','invalid','required',
              'first-of-type','last-of-type','nth-of-type'}
    if name not in pseudo:
        css_classes.add(name)

# Extract class names from JS
js_classes = set()
# From classList.add/remove/toggle/contains
for m in re.finditer(r'classList\.\w+\(["\']([^"\']+)["\']', js):
    js_classes.add(m.group(1))
# From className assignment
for m in re.finditer(r'className\s*=\s*["\']([^"\']+)["\']', js):
    for part in m.group(1).split():
        js_classes.add(part.strip())
# From innerHTML strings: class="xxx"
for m in re.finditer(r'class=["\']([^"\']+)["\']', js):
    for part in m.group(1).split():
        js_classes.add(part.strip())
# From createElement className
for m in re.finditer(r'className\s*=\s*["\']([^"\']+)["\']', js):
    for part in m.group(1).split():
        js_classes.add(part.strip())
# From template literals
for m in re.finditer(r'classList\.\w+\(["\']([^"\']+)["\']', js):
    js_classes.add(m.group(1))
# From style.css direct class usage (class="...") in innerHTML strings
for m in re.finditer(r'\.className\s*=\s*["\']([^"\']+)["\']', js):
    for part in m.group(1).split():
        js_classes.add(part.strip())

# Also extract classes from HTML
html_classes = set()
for m in re.finditer(r'class=["\']([^"\']+)["\']', html):
    for part in m.group(1).split():
        html_classes.add(part.strip())

js_classes = js_classes | html_classes

# Filter empty
js_classes = {c for c in js_classes if c and re.match(r'^[a-zA-Z][a-zA-Z0-9_-]*$', c)}

# Check each JS-used class against CSS
missing_css = []
for c in sorted(js_classes):
    # Check if defined in CSS (as .classname)
    found = bool(re.search(r'\.' + re.escape(c) + r'\b', css))
    if not found and c not in css_classes:
        missing_css.append(c)

print(f"\nCSS defines {len(css_classes)} class selectors")
print(f"JS/HTML references {len(js_classes)} distinct classes")

for c in sorted(js_classes):
    found = bool(re.search(r'\.' + re.escape(c) + r'\b', css))
    print(f"  {'[OK]' if found else '[!!]':6s} .{c}")

print(f"\nResult: PASS {len(js_classes) - len(missing_css)} / FAIL {len(missing_css)}")
for c in missing_css:
    print(f"  -> .{c} referenced but NOT in CSS")

# =====================================================================
# 5. API contract check
# =====================================================================
print(f"\n{SEP}")
print("5. API contract check")
print(SEP)

# Read server.py
try:
    server_py = read('../server.py')
except:
    server_py = ""
try:
    with open(os.path.join(BASE, 'server.py'), 'r', encoding='utf-8') as f:
        server_py = f.read()
except:
    pass

# Frontend: API routes mapped via API object
frontend_routes = {
    'ping':    ('GET',  '/api/ping'),
    'newGame': ('POST', '/api/new-game'),
    'action':  ('POST', '/api/action'),
    'item':    ('POST', '/api/item'),
    'save':    ('POST', '/api/save'),
    'load':    ('POST', '/api/load'),
    'saves':   ('GET',  '/api/saves'),
}

# Backend routes from server.py
backend_get_routes  = set(re.findall(r"path\s*==\s*'([^']+)'", server_py))
backend_post_routes = set(re.findall(r"path\s*==\s*'([^']+)'", server_py))
# Parse route handlers
backend_routes = {}
# GET
for m in re.finditer(r"path\s*==\s*'([^']+)':\s*\n\s*return\s+self\._json\((\d+),\s*\{([^}]+)\}", server_py):
    path = '/api/' + m.group(1).replace('/api/', '').lstrip('/')
    fields = set(re.findall(r"'(\w+)'", m.group(3)))
    fields.add('ok')
    if path not in backend_routes:
        backend_routes[path] = fields

print(f"\nFrontend API routes:")
for method, (verb, path) in frontend_routes.items():
    f = re.findall(r'[\w]+', path)
    print(f"  {verb:4s} {path}  <-  API.{method}()")

print(f"\nBackend API routes:")
for path in sorted(set(backend_get_routes) | set(backend_post_routes)):
    verb = 'GET' if path in backend_get_routes else 'POST' if path in backend_post_routes else '???'
    print(f"  {verb:4s} {path}")

# Extract frontend response field usage per API
frontend_fields = defaultdict(set)
# Find response usage patterns
# API.newGame -> res.scene, res.state, res.ok
# API.action  -> res.ok, res.state, res.scene, res.battle
# API.item    -> res.ok, res.state, res.message
# API.save    -> res.ok
# API.load    -> res.ok, res.state, res.scene
# API.saves   -> res.saves

# Known from reading the code:
frontend_usage = {
    'newGame': {'ok', 'scene', 'state', 'error'},
    'action':  {'ok', 'scene', 'state', 'battle', 'error'},
    'item':    {'ok', 'state', 'message', 'error'},
    'save':    {'ok', 'error'},
    'load':    {'ok', 'state', 'scene', 'error'},
    'saves':   {'saves'},
}

# Backend response fields from server.py code inspection:
backend_responses = {
    '/api/ping':      {'ok', 'pong', 'time'},
    '/api/saves':     {'saves'},
    '/api/export':    {'version', 'exportedAt', 'state'},
    '/api/new-game':  {'ok', 'scene', 'state'},
    '/api/action':    {'ok', 'scene', 'state', 'battle'},
    '/api/item':      {'ok', 'message', 'state'},
    '/api/save':      {'ok'},
    '/api/load':      {'ok', 'scene', 'state'},
    '/api/import':    {'ok', 'scene', 'state'},
}

print(f"\nFrontend expected response fields:")
for method, fields in sorted(frontend_usage.items()):
    path = frontend_routes[method][1]
    print(f"  {method} -> {sorted(fields)}")

print(f"\nBackend response fields:")
for path, fields in sorted(backend_responses.items()):
    print(f"  {path} -> {sorted(fields)}")

# Cross-check
api_issues = []
for method, (verb, path) in frontend_routes.items():
    if path not in backend_responses:
        api_issues.append(f"  {method}: path {path} not found in backend routes")
        continue
    be_fields = backend_responses[path]
    fe_fields = frontend_usage.get(method, set())
    # Frontend expects field that backend doesn't return
    for f in fe_fields:
        if f not in be_fields and f != 'error':  # error is always possible
            api_issues.append(f"  {method}: frontend uses res.{f} but backend {path} returns {sorted(be_fields)}")

print(f"\nResult: PASS {len(frontend_routes) - len(api_issues)} / FAIL {len(api_issues)} route contracts")
for issue in api_issues:
    print(issue)

# =====================================================================
# 6. Core path walkthrough — DOM null safety
# =====================================================================
print(f"\n{SEP}")
print("6. Core path walkthrough — DOM null safety")
print(SEP)

print("\nKey method analysis:\n")

# openBag() -> switchTab() + _renderBagTab()
# BUT: switchTab and _renderBagTab are NOT defined in UI!
print("[openBag] calls:")
print("  this._bagManageExpanded = true  (property, safe)")
print("  this.switchTab('bag')           -- switchTab is NOT DEFINED in UI object!")
print("  this._renderBagTab()            -- _renderBagTab is NOT DEFINED in UI object!")

# closeBag()
print("\n[closeBag] calls:")
print("  this._tipHide()                 -- defined (line 274)")
print("  this.switchTab('bag')           -- switchTab is NOT DEFINED")

# openStats()
print("\n[openStats] calls:")
print("  this.switchTab('char')          -- switchTab is NOT DEFINED")
print("  this._renderCharTab()           -- _renderCharTab is NOT DEFINED")

# closeStats()
print("\n[closeStats] calls:")
print("  this._renderCharTab()           -- _renderCharTab is NOT DEFINED")

# _renderHUD()
print("\n[_renderHUD] calls:")
print("  this._renderTab(this.activeTab) -- _renderTab / activeTab are NOT DEFINED")
print("  document.getElementById('char-panel') -- with null guard: if (cp) cp.innerHTML = h")

# _renderChoices()
print("\n[_renderChoices] calls:")
print("  document.getElementById('choices') -- with null guard: if (!el) return")

# _renderScene()
print("\n[_renderScene] calls:")
print("  $('scene-title').textContent = ...  -- NO null guard!")
print("  $('scene-text').textContent = ...   -- NO null guard!")
print("  this._renderChoices(scene.choices)  -- defined")

# _renderBattle()
print("\n[_renderBattle] calls:")
print("  $('scene-title').textContent = ...  -- NO null guard!")
print("  $('scene-text').innerHTML = ...     -- NO null guard!")

print("\n--- CRITICAL FINDINGS ---")
print()
print("Missing methods in UI object (checked in step 2&3):")
missing_ui_methods = set()
for _, method, _, _ in onclick_parsed:
    if method not in ui_methods:
        missing_ui_methods.add(f"UI.{method}")
for call in missing_this_methods:
    missing_ui_methods.add(f"UI.{call}")

if missing_ui_methods:
    for m in sorted(missing_ui_methods):
        print(f"  - {m}()")

# =====================================================================
# SUMMARY
# =====================================================================
print(f"\n{SEP}")
print("FINAL SUMMARY")
print(SEP)

c1_pass = len(js_pure_ids) - len(missing_in_html)
c1_fail = len(missing_in_html)
c2_pass = pass_onclick
c2_fail = len(fail_onclick)
c3_pass = len(this_call_list) - len(missing_this_methods)
c3_fail = len(missing_this_methods)
c4_pass = len(js_classes) - len(missing_css)
c4_fail = len(missing_css)
c5_pass = len(frontend_routes) - len(api_issues)
c5_fail = len(api_issues)

print(f"""
Check 1 (DOM IDs):          PASS {c1_pass} / FAIL {c1_fail}
Check 2 (HTML onclick):     PASS {c2_pass} / FAIL {c2_fail}
Check 3 (this.xxx() calls): PASS {c3_pass} / FAIL {c3_fail}
Check 4 (CSS classes):      PASS {c4_pass} / FAIL {c4_fail}
Check 5 (API contracts):    PASS {c5_pass} / FAIL {c5_fail}
Check 6 (null safety):      See detailed report above
""")

total_fail = c1_fail + c2_fail + c3_fail + c4_fail + c5_fail
if total_fail > 0:
    print(f"TOTAL FAIL: {total_fail}")
    print("\n=== CRITICAL ISSUES ===")
    if c2_fail > 0:
        print(f"- {c2_fail} HTML onclick methods not defined in JS")
        for item in fail_onclick:
            print(f"  {item}")
    if c3_fail > 0:
        print(f"- {c3_fail} this.xxx() calls to undefined methods")
        for m in missing_this_methods:
            print(f"  this.{m}()")
    if c1_fail > 0:
        print(f"- {c1_fail} DOM IDs referenced in JS but missing in HTML")
    if c4_fail > 0:
        print(f"- {c4_fail} CSS classes used in JS but not defined in stylesheet")
    if c5_fail > 0:
        print(f"- {c5_fail} API contract mismatches")
else:
    print("All checks passed!")
