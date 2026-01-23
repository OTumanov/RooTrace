# Phase 2.2: PROBE SMOKE TEST (MANDATORY BEFORE PHASE 3)

**🚨 CRITICAL:** Before moving to Phase 3 (HYPOTHESES), you MUST verify the connection works with a REAL test log. This prevents wasting time on instrumentation if network/server is broken.

## MANDATORY STEPS

1. **SEND TEST LOG AND VERIFY RESPONSE** (from target environment):
   - **🚨 CRITICAL:** Server returns identifiable response for SMOKE_TEST. You MUST check response body, NOT just HTTP status.
   - **If Docker detected (from Phase 2):**
     - Get `CONTAINER_ID` from Phase 2 (or find it again via `docker ps`)
     - **EXECUTE:** `docker exec <CONTAINER_ID> python3 -c "import http.client, json; conn = http.client.HTTPConnection('{{FINAL_HOST}}', {{ACTUAL_PORT}}); conn.request('POST', '/', json.dumps({'hypothesisId': 'SMOKE_TEST', 'message': 'SMOKE_TEST: Connection verified', 'state': {'test': 'success', 'timestamp': '...'}}), {'Content-Type': 'application/json'}); resp = conn.getresponse(); body = resp.read().decode(); print(f'{resp.status}:{body}')"` via `execute_command`
     - **Alternative (if python3 not available in container):** Use `curl`: `docker exec <CONTAINER_ID> curl -X POST http://{{FINAL_HOST}}:{{ACTUAL_PORT}}/ -H "Content-Type: application/json" -d '{"hypothesisId":"SMOKE_TEST","message":"SMOKE_TEST: Connection verified","state":{"test":"success"}}' -w "\nHTTP_STATUS:%{http_code}"`
   - **If NO Docker (local environment):**
     - **EXECUTE:** `python3 -c "import http.client, json; conn = http.client.HTTPConnection('{{FINAL_HOST}}', {{ACTUAL_PORT}}); conn.request('POST', '/', json.dumps({'hypothesisId': 'SMOKE_TEST', 'message': 'SMOKE_TEST: Connection verified', 'state': {'test': 'success', 'timestamp': '...'}}), {'Content-Type': 'application/json'}); resp = conn.getresponse(); body = resp.read().decode(); print(f'{resp.status}:{body}')"` via `execute_command`
     - **Alternative:** Use `curl`: `curl -X POST http://{{FINAL_HOST}}:{{ACTUAL_PORT}}/ -H "Content-Type: application/json" -d '{"hypothesisId":"SMOKE_TEST","message":"SMOKE_TEST: Connection verified","state":{"test":"success"}}' -w "\nHTTP_STATUS:%{http_code}"`
   - **OUTPUT:** `SMOKE_TEST: Sent (HTTP status: [200|404|405|error])`

2. **VERIFY SERVER RESPONSE** (check response body):
   - **MANDATORY:** Parse response body from command output
   - **SEARCH:** Look for `"SMOKE_TEST_VERIFIED"` or `"message": "SMOKE_TEST_VERIFIED"` in response body
   - **SEARCH:** Look for `"received": true` in response body
   - **OUTPUT:** `SMOKE_TEST: [verified|not verified]` based on response body content

3. **STOP/GO CRITERION**:
   - ✅ **GO:** If response body contains `"SMOKE_TEST_VERIFIED"` AND `"received": true` → **OUTPUT:** `SMOKE_TEST: PASSED. Connection verified. Server response: SMOKE_TEST_VERIFIED. Proceeding to Phase 3.`
   - ❌ **STOP:** If response body does NOT contain `"SMOKE_TEST_VERIFIED"` OR HTTP status is not 200 → **OUTPUT:** `SMOKE_TEST: FAILED. Network/server issue detected. Response: [response body]. Cannot proceed to instrumentation.`
     - **MANDATORY:** Do NOT proceed to Phase 3 (HYPOTHESES) or Phase 4 (INSTRUMENTATION)
     - **MANDATORY:** Report failure to user: `ERROR: Smoke test failed. Server at http://<FINAL_HOST>:<ACTUAL_PORT> is not receiving logs. Check server status, Docker bridge, or firewall.`
     - **MANDATORY:** Suggest debugging steps: check `get_debug_status`, verify Docker bridge, check firewall rules

**Why this is critical:**
- **Feedback Loop:** You don't just "think" connection works, you **prove** it with actual data
- **Token Economy:** Prevents wasting tokens on backups, patches, and instrumentation if network is broken
- **Trust:** User sees "Smoke test successful!" - best anti-stress signal before starting instrumentation

**PENALTY:** Proceeding to Phase 3 without smoke test or ignoring smoke test failure = +10 points (CRITICAL FAILURE).
