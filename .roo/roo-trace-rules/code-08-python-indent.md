# PYTHON INDENTATION STRATEGY (CRITICAL)

To avoid breaking Python syntax, follow "Anchor Line" algorithm:

## Rule of Thumb

Probe indentation must LITERALLY match indentation of line BEFORE which you make insertion.

## Action

1. Call `read_file` and find target line (by `lineNumber`).
2. Copy all spaces/tabs from line start to first character.
3. Use THIS SAME prefix for each line of your `probeCode`.

## Separate lines for each operator

Each probe operator (`import`, assignment, method call) must be on separate line with correct indentation. This is Pylance requirement.

## 🧩 EXAMPLE PERFECT INSERTION

If code:
```python
    def pop(self):
        # Target line 596
        return self.heap.pop()
```

Your `probeCode` (with 8-space indentation, each operator on separate line):
```python
        # RooTrace [id: <uuid>] H1: description
        # NOTE: Replace {{FINAL_HOST}} and {{ACTUAL_PORT}} with values from Phase 2 discovery
        try:
            import http.client, json, socket
            conn = http.client.HTTPConnection("{{FINAL_HOST}}", {{ACTUAL_PORT}})
            conn.sock = socket.create_connection(("{{FINAL_HOST}}", {{ACTUAL_PORT}}), timeout=5.0)
            conn.request("POST", "/", json.dumps({'hypothesisId': 'H1', 'message': 'pop', 'state': {}}), {'Content-Type': 'application/json'})
            conn.getresponse()
            conn.close()
        except: pass
        # RooTrace [id: <uuid>]: end
```
**🚨 CRITICAL:** Each operator on separate line with correct indentation (8 spaces in this example). This is Pylance requirement.
**CRITICAL:** For IFC parsing, multithreading, and CPU-intensive tasks use `timeout=5.0` (NOT 1.0, NOT 0.1)

## CRITICAL RULES

- **CRITICAL:** DO NOT guess indentation. DO NOT use "logic" (+4 spaces for if, +8 for nested). COPY them literally from adjacent line.
- **FORBIDDEN:** Use one line with semicolons. This causes Pylance errors. ALWAYS use format above (each operator on separate line).
- **FORBIDDEN:** If Pylance complains — problem is ALWAYS in indentation or probe breaking syntactic construct. Use Block Rewrite (complete function replacement), don't try to "fix" probe.

## 🚨 CRITICAL: PYLANCE ERRORS AND PYTHON SYNTAX

**If Pylance or py_compile reports syntax error:**
- ❌ **FORBIDDEN:** Think that need to "use semicolons" or "split operators with semicolons"
- ❌ **FORBIDDEN:** Say "Problem is that Pylance expects line break" and try to "simplify probes"
- ✅ **CORRECT:** Problem is ALWAYS that **Pylance expects LINE BREAK** between operators
- ✅ **SOLUTION:** Probe MUST be on SEPARATE line with correct indentation, NOT on same line with other operators
