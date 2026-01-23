# Phase 2: NETWORK DISCOVERY (Dynamic Port & Docker Bridge)

**🚨 CRITICAL:** Before instrumentation, you MUST discover actual server endpoint. NO hardcoding `localhost:51234`!

## 1. FIND PORT (Dynamic Port Discovery)

**PRIORITY ORDER:**

1. **Read `.rootrace/debug_port` or `.debug_port` file:**
   - Read `.rootrace/debug_port` or `.debug_port` in project root via `read_file`.
   - Let's call this `ACTUAL_PORT`. If file contains just a number (e.g., `51234` or `51235`), use that.
   - **OUTPUT:** `PORT: [ACTUAL_PORT]` (e.g., `PORT: 51235`)

2. **If file not found, check `.rootrace/ai_debug_config`:**
   - May contain encrypted URL or port information.
   - Parse if available.

3. **🚨 NEW: Parse `docker ps` output for mapped port (CRITICAL FOR DOCKER):**
   - **MANDATORY:** If Docker detected (see step 2), run `docker ps` via `execute_command`.
   - **PARSE OUTPUT:** Extract mapped port from PORTS column using regex:
     - **Regex pattern:** `0\.0\.0\.0:(\d+)->\d+/tcp` or `:::\d+->\d+/tcp` or `(\d+\.\d+\.\d+\.\d+):(\d+)->\d+/tcp`
     - **Example output:**
       ```
       CONTAINER ID   IMAGE     COMMAND   CREATED   STATUS   PORTS                    NAMES
       abc123def456   app:1.0   ...       1h ago    Up 1h    0.0.0.0:51235->8080/tcp, 0.0.0.0:8080->8080/tcp   app-container
       ```
     - **🚨 CRITICAL: PORT SELECTION PRIORITY (when multiple ports exist):**
       1. **FIRST PRIORITY:** If `.debug_port` file was found in step 1, extract port number from it (e.g., `51234`). Search for EXACT match in `docker ps` output. If found → use this port.
       2. **SECOND PRIORITY:** If `.debug_port` not found OR exact match not found, search for port in RooTrace range (51234-51299). If multiple ports in this range exist, prefer the one closest to 51234 (default).
       3. **THIRD PRIORITY:** If no port in RooTrace range found, use the first port found from regex parsing.
     - **Extraction logic:**
       - Parse ALL port mappings from PORTS column
       - Extract all mapped ports (host ports, not container ports)
       - Apply priority selection above
       - **Example:** If `.debug_port` contains `51234` and `docker ps` shows `0.0.0.0:51234->8080/tcp, 0.0.0.0:8080->8080/tcp` → select `51234` (exact match from .debug_port)
       - **Example:** If `.debug_port` not found and `docker ps` shows `0.0.0.0:51235->8080/tcp, 0.0.0.0:8080->8080/tcp` → select `51235` (in RooTrace range 51234-51299)
       - **Example:** If `.debug_port` contains `51234` but `docker ps` shows only `0.0.0.0:8080->8080/tcp` → WARNING: Port 51234 not found in docker ps, using 8080 (but this is unusual - check configuration)
     - **OUTPUT:** `PORT: [ACTUAL_PORT] from docker ps` (e.g., `PORT: 51235 from docker ps`) or `PORT: [ACTUAL_PORT] from docker ps (matched .debug_port: [PORT])` if exact match found

4. **Fallback:**
   - If still not found, assume `51234` but **WARNING** user: `WARNING: Port file not found, assuming default 51234`.
   - **OUTPUT:** `PORT: 51234 (default, no discovery)`

## 2. ENVIRONMENT DETECTION (MANDATORY)

1. **FIRST:** Check for Docker indicators in project root via `read_file` or `list_directory`:
   - Look for `Dockerfile`, `docker-compose.yml`, `docker-compose.yaml`, `.dockerignore`
   - If ANY of these files exist → **MUST** check Docker (project uses Docker)

2. **THEN:** Run `docker ps` via `execute_command` to check if Docker containers are running.
   - **CRITICAL:** If Docker files exist OR `docker ps` shows containers → **MUST** proceed to Docker bridge check (step 3).
   - **OUTPUT:** `ENV: [docker/local]` based on Docker files presence AND `docker ps` result.
   - **PENALTY:** Skipping Docker check when Docker files exist = +10 points (CRITICAL FAILURE).

## 3. NETWORK RECONNAISSANCE (The Docker Bridge) (MANDATORY IF DOCKER DETECTED)

**If Docker files exist OR `docker ps` shows containers:**

1. **MANDATORY:** You MUST check Docker bridge. DO NOT skip this step!

2. **Get `CONTAINER_ID` for the app:**
   - Try: `docker ps --format "{{.ID}}" --filter "ancestor=<app_image>"` (if you know image name)
   - Or: `docker ps --format "{{.ID}}"` and select the first running container
   - Or: `docker ps -q` to get all container IDs

3. **EXECUTE bridge test:**
   - `docker exec <CONTAINER_ID> curl -s -o /dev/null -w "%{http_code}" http://host.docker.internal:<ACTUAL_PORT>/` via `execute_command`.
   - If HTTP code is `200/404/405` (server responds): `FINAL_HOST = "host.docker.internal"`
   - Else if failed (connection refused/timeout): Try `FINAL_HOST = "172.17.0.1"` (Linux bridge) and verify again with `docker exec <CONTAINER_ID> curl -s -o /dev/null -w "%{http_code}" http://172.17.0.1:<ACTUAL_PORT>/`
   - **OUTPUT:** `DOCKER_BRIDGE: [host.docker.internal|172.17.0.1|failed]`
   - **CRITICAL:** If Docker files exist but you skip Docker bridge check → +10 points (CRITICAL FAILURE)

**If NO Docker files AND `docker ps` shows no containers:**
- `FINAL_HOST = "localhost"`
- **OUTPUT:** `DOCKER_BRIDGE: not needed (local environment)`

## 4. VERIFICATION & STORAGE

1. Store `FINAL_HOST` and `ACTUAL_PORT` in your internal state for ALL subsequent probe generation.
2. Report to user: `[RooTrace] Discovery complete. Using http://<FINAL_HOST>:<ACTUAL_PORT>`
3. **OUTPUT:** `NETWORK: http://<FINAL_HOST>:<ACTUAL_PORT>`

## 5. MANDATORY: Pass both `FINAL_HOST` and `ACTUAL_PORT` into EVERY `probeCode` template

- **FORBIDDEN:** Hardcode `localhost:51234` in probe code.
- **MANDATORY:** Use discovered values: `http://<FINAL_HOST>:<ACTUAL_PORT>/` in all probes.

**Example probe template (Python):**
```python
target_host = "{{FINAL_HOST}}"  # Will be "host.docker.internal" or "localhost"
target_port = {{ACTUAL_PORT}}   # Will be actual port from .debug_port or docker ps
conn = http.client.HTTPConnection(target_host, target_port)
```

**Example probe template (Go):**
```go
serverURL := fmt.Sprintf("http://%s:%d/", "{{FINAL_HOST}}", {{ACTUAL_PORT}})
```

## 🚨 CRITICAL: Docker Port Parsing Regex

**When parsing `docker ps` output, use these regex patterns:**

1. **IPv4 mapping:** `0\.0\.0\.0:(\d+)->\d+/tcp`
   - Matches: `0.0.0.0:51235->8080/tcp`
   - Captures: `51235`

2. **IPv6 mapping:** `:::(\d+)->\d+/tcp`
   - Matches: `:::51235->8080/tcp`
   - Captures: `51235`

3. **Specific IP mapping:** `(\d+\.\d+\.\d+\.\d+):(\d+)->\d+/tcp`
   - Matches: `192.168.1.100:51235->8080/tcp`
   - Captures: `192.168.1.100` and `51235` (use port, ignore IP)

4. **Multiple ports:** If multiple mappings exist:
   - **PRIORITY 1:** If `.debug_port` file exists, use port from it and find EXACT match in docker ps
   - **PRIORITY 2:** If no exact match or `.debug_port` not found, prefer port in RooTrace range (51234-51299), closest to 51234
   - **PRIORITY 3:** If no port in RooTrace range, use first port found
   - **OUTPUT:** `PORT: [ACTUAL_PORT] from docker ps (selected from [N] mappings, priority: [exact_match|roo_range|first])`

**Example parsing logic:**

**Example 1: Single port**
```
docker ps output:
CONTAINER ID   IMAGE     PORTS                    NAMES
abc123def456   app:1.0   0.0.0.0:51235->8080/tcp   app-container

Regex: 0\.0\.0\.0:(\d+)->\d+/tcp
Match: 0.0.0.0:51235->8080/tcp
Capture group 1: 51235
ACTUAL_PORT = 51235
```

**Example 2: Multiple ports with .debug_port**
```
.debug_port file contains: 51234
docker ps output:
CONTAINER ID   IMAGE     PORTS                                    NAMES
abc123def456   app:1.0   0.0.0.0:51234->8080/tcp, 0.0.0.0:8080->8080/tcp   app-container

Parse all ports: [51234, 8080]
Priority 1: .debug_port = 51234 → EXACT MATCH found in docker ps
ACTUAL_PORT = 51234 (exact match from .debug_port)
```

**Example 3: Multiple ports without .debug_port**
```
.debug_port file NOT found
docker ps output:
CONTAINER ID   IMAGE     PORTS                                    NAMES
abc123def456   app:1.0   0.0.0.0:51235->8080/tcp, 0.0.0.0:8080->8080/tcp   app-container

Parse all ports: [51235, 8080]
Priority 1: .debug_port not found → skip
Priority 2: Port 51235 in RooTrace range (51234-51299) → SELECT
ACTUAL_PORT = 51235 (RooTrace range match)
```

**Example 4: Multiple ports, no RooTrace range match**
```
.debug_port file NOT found
docker ps output:
CONTAINER ID   IMAGE     PORTS                                    NAMES
abc123def456   app:1.0   0.0.0.0:3000->3000/tcp, 0.0.0.0:8080->8080/tcp   app-container

Parse all ports: [3000, 8080]
Priority 1: .debug_port not found → skip
Priority 2: No ports in RooTrace range (51234-51299) → skip
Priority 3: Use first port found
ACTUAL_PORT = 3000 (first port, WARNING: not in RooTrace range)
```

**PENALTY:** Hardcoding `localhost:51234` instead of parsing `docker ps` = +10 points (CRITICAL FAILURE)
