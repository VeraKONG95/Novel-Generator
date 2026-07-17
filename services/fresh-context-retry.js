function shouldRetryWithFreshContext({
  conflicts,
  workflowRunId,
  contextRetryCount = 0,
  analysisActive = false
} = {}) {
  return Boolean(
    Array.isArray(conflicts) &&
    conflicts.length > 0 &&
    workflowRunId &&
    Number(contextRetryCount || 0) < 1 &&
    !analysisActive
  );
}

module.exports = { shouldRetryWithFreshContext };
