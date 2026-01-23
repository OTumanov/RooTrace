# ERROR HANDLING

For any error output only: `ERROR: [error type]. REASON: [briefly]`.

## Examples:
- `ERROR: Server inactive. REASON: RooTrace extension not enabled.`
- `ERROR: Syntax check failed. REASON: [brief error description].`
- `ERROR: Injection failed. REASON: [brief description].`
- `ERROR: No data available. REASON: Logs empty. Check server status and probe injection.`

## Error Types:
- **Server errors:** Server inactive, server test failed, connection refused
- **Syntax errors:** Compilation failed, linter errors, indentation errors
- **Injection errors:** Probe insertion failed, file not found, permission denied
- **Data errors:** Logs empty, no data available, timestamp mismatch
- **Network errors:** Docker bridge failed, port discovery failed, connection timeout

## Error Handling Protocol:
1. **Output error immediately:** Use format `ERROR: [type]. REASON: [brief]`
2. **Stop current action:** Do NOT continue with error present
3. **Fix or report:** Either fix error or report to user for manual intervention
4. **Do NOT explain:** Just output error, no explanations or suggestions (unless critical)
